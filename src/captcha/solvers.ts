/**
 * 외부 캡챠 해결 서비스 (spec 2-2 모드 2).
 * 디시 삭제/로그인 캡챠는 이미지 코드형이므로(dc-protocol §5) ImageToTextTask만 쓴다.
 * 근거 문서 (2026-11-26 확인):
 *  - 2Captcha API v2  https://2captcha.com/api-docs/normal-captcha
 *  - Anti-Captcha     https://anti-captcha.com/apidoc/task-types/ImageToTextTask
 *  - CapSolver        https://docs.capsolver.com/en/guide/recognition/ImageToTextTask/ (동기 응답)
 * API 키는 요청 본문에만 들어가고 로그에는 남기지 않는다.
 */

export type SolverId = '2captcha' | 'anticaptcha' | 'capsolver';

export const SOLVERS: Record<SolverId, { name: string; host: string }> = {
  '2captcha': { name: '2Captcha', host: 'https://api.2captcha.com' },
  anticaptcha: { name: 'Anti-Captcha', host: 'https://api.anti-captcha.com' },
  capsolver: { name: 'CapSolver', host: 'https://api.capsolver.com' },
};

export type SolverErrorCode = 'invalidKey' | 'zeroBalance' | 'unsolvable' | 'busy' | 'timeout' | 'badImage' | 'network' | 'unknown';

export class SolverError extends Error {
  constructor(
    readonly code: SolverErrorCode,
    message: string,
    readonly serviceCode?: string,
  ) {
    super(message);
    this.name = 'SolverError';
  }
}

export interface CaptchaSolver {
  readonly id: SolverId;
  /** base64 이미지(접두어 없음) → 풀이 텍스트 */
  solveImage(base64: string, signal?: AbortSignal): Promise<string>;
  /** 잔액 (USD) */
  getBalance(): Promise<number>;
}

export type JsonPost = (url: string, body: unknown, signal?: AbortSignal) => Promise<unknown>;

export const defaultJsonPost: JsonPost = async (url, body, signal) => {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    if (signal?.aborted) throw new SolverError('timeout', '캡챠 서비스 응답 시간이 초과되었습니다.');
    throw new SolverError('network', '캡챠 서비스에 연결하지 못했습니다.');
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new SolverError('unknown', `캡챠 서비스 응답을 해석하지 못했습니다 (HTTP ${res.status}).`);
  }
};

type ApiReply = { errorId?: number; errorCode?: string; errorDescription?: string; status?: string; taskId?: number | string; balance?: number; solution?: { text?: string } };

const ERROR_MAP: Record<string, SolverErrorCode> = {
  ERROR_KEY_DOES_NOT_EXIST: 'invalidKey',
  ERROR_KEY_DENIED_ACCESS: 'invalidKey',
  ERROR_WRONG_USER_KEY: 'invalidKey',
  ERROR_ZERO_BALANCE: 'zeroBalance',
  ERROR_CAPTCHA_UNSOLVABLE: 'unsolvable',
  ERROR_NO_SLOT_AVAILABLE: 'busy',
  ERROR_RATE_LIMIT: 'busy',
  ERROR_SERVICE_UNAVALIABLE: 'busy',
  ERROR_TASK_TIMEOUT: 'timeout',
  ERROR_ZERO_CAPTCHA_FILESIZE: 'badImage',
  ERROR_TOO_BIG_CAPTCHA_FILESIZE: 'badImage',
  ERROR_IMAGE_TYPE_NOT_SUPPORTED: 'badImage',
  ERROR_INVALID_IMAGE: 'badImage',
  ERROR_PARSE_IMAGE_FAIL: 'badImage',
};

const MESSAGES: Record<SolverErrorCode, string> = {
  invalidKey: 'API 키가 올바르지 않습니다.',
  zeroBalance: '캡챠 서비스 잔액이 없습니다.',
  unsolvable: '캡챠를 풀지 못했습니다.',
  busy: '캡챠 서비스가 바쁩니다. 잠시 후 다시 시도하세요.',
  timeout: '캡챠 풀이 시간이 초과되었습니다.',
  badImage: '캡챠 이미지를 처리하지 못했습니다.',
  network: '캡챠 서비스에 연결하지 못했습니다.',
  unknown: '캡챠 서비스 오류가 발생했습니다.',
};

function check(reply: unknown): ApiReply {
  if (typeof reply !== 'object' || reply === null) throw new SolverError('unknown', MESSAGES.unknown);
  const r = reply as ApiReply;
  if (r.errorId && r.errorId !== 0) {
    const code = ERROR_MAP[r.errorCode ?? ''] ?? 'unknown';
    throw new SolverError(code, MESSAGES[code], r.errorCode);
  }
  return r;
}

type Opts = { post?: JsonPost; sleep?: (ms: number) => Promise<void>; pollMs?: number; timeoutMs?: number; now?: () => number };

/** 2Captcha v2와 Anti-Captcha는 같은 createTask / getTaskResult 형식이다. */
class TaskApiSolver implements CaptchaSolver {
  protected readonly post: JsonPost;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pollMs: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(
    readonly id: SolverId,
    protected readonly apiKey: string,
    opts: Opts = {},
  ) {
    this.post = opts.post ?? defaultJsonPost;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.pollMs = opts.pollMs ?? 5_000;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.now = opts.now ?? Date.now;
  }

  protected get host() {
    return SOLVERS[this.id].host;
  }

  protected task(base64: string): Record<string, unknown> {
    return { type: 'ImageToTextTask', body: base64, case: false, phrase: false };
  }

  async solveImage(base64: string, signal?: AbortSignal): Promise<string> {
    const created = check(await this.post(`${this.host}/createTask`, { clientKey: this.apiKey, task: this.task(base64) }, signal));
    if (created.taskId === undefined) throw new SolverError('unknown', MESSAGES.unknown);
    const deadline = this.now() + this.timeoutMs;
    while (this.now() < deadline) {
      await this.sleep(this.pollMs);
      if (signal?.aborted) throw new SolverError('timeout', MESSAGES.timeout);
      const r = check(await this.post(`${this.host}/getTaskResult`, { clientKey: this.apiKey, taskId: created.taskId }, signal));
      if (r.status === 'ready') {
        const text = r.solution?.text?.trim();
        if (!text) throw new SolverError('unsolvable', MESSAGES.unsolvable);
        return text;
      }
    }
    throw new SolverError('timeout', MESSAGES.timeout);
  }

  async getBalance(): Promise<number> {
    const r = check(await this.post(`${this.host}/getBalance`, { clientKey: this.apiKey }));
    if (typeof r.balance !== 'number') throw new SolverError('unknown', MESSAGES.unknown);
    return r.balance;
  }
}

class AntiCaptchaSolver extends TaskApiSolver {
  protected task(base64: string) {
    return { ...super.task(base64), languagePool: 'en' };
  }
}

/** CapSolver ImageToTextTask는 createTask 응답에 바로 결과가 온다. */
class CapSolverSolver extends TaskApiSolver {
  async solveImage(base64: string, signal?: AbortSignal): Promise<string> {
    const r = check(
      await this.post(`${this.host}/createTask`, { clientKey: this.apiKey, task: { type: 'ImageToTextTask', body: base64, module: 'common' } }, signal),
    );
    const text = r.solution?.text?.trim();
    if (r.status !== 'ready' || !text) throw new SolverError('unsolvable', MESSAGES.unsolvable);
    return text;
  }
}

export function createSolver(id: SolverId, apiKey: string, opts: Opts = {}): CaptchaSolver {
  switch (id) {
    case '2captcha':
      return new TaskApiSolver(id, apiKey, opts);
    case 'anticaptcha':
      return new AntiCaptchaSolver(id, apiKey, opts);
    case 'capsolver':
      return new CapSolverSolver(id, apiKey, opts);
  }
}
