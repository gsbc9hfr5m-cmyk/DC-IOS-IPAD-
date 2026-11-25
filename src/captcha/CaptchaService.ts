/**
 * 캡챠 처리 흐름 (spec 2-2).
 * - 수동: 이미지를 시트로 띄우고 사용자가 입력한다.
 * - 자동: 외부 서비스로 푼다. 실패, 잔액 부족, 타임아웃이면 로컬 알림을 보내고 수동으로 넘어간다.
 * 이 모듈은 UI, 저장소, 알림에 직접 의존하지 않는다 (의존성 주입 → 단위 테스트 가능).
 */
import { SolverError, type CaptchaSolver, type SolverId } from './solvers';

export type CaptchaContext = 'login' | 'delete';

export type CaptchaChallenge = {
  context: CaptchaContext;
  /** 절대 URL */
  imageUrl: string;
  randCode: string;
};

export type CaptchaAnswer = { code: string; randCode: string };

export type ManualRequest = {
  context: CaptchaContext;
  imageBase64: string;
  /** 자동 풀이에 실패해서 넘어온 경우 이유 */
  fallbackReason?: string;
  /** 같은 randCode로 새 이미지를 받는다 */
  reload: () => Promise<string>;
};

export type CaptchaDeps = {
  getMode: () => 'manual' | 'auto';
  getSolverId: () => SolverId;
  getApiKey: (id: SolverId) => Promise<string | null>;
  createSolver: (id: SolverId, apiKey: string) => CaptchaSolver;
  /** 세션 쿠키를 유지한 채 이미지를 받아 base64로 */
  fetchImageBase64: (url: string) => Promise<string>;
  /** 사용자 입력. 취소하면 null */
  askManual: (req: ManualRequest) => Promise<string | null>;
  notify: (title: string, body: string) => void;
  timeoutMs?: number;
};

export type SolveOptions = {
  /** 자동 풀이 답이 틀린 뒤 재시도할 때 등 */
  forceManual?: boolean;
};

export type SolveResult = { answer: CaptchaAnswer; via: 'auto' | 'manual' } | null;

export function withCacheBuster(url: string, now = Date.now()): string {
  const base = url.split('&v=')[0] ?? url;
  return `${base}${base.includes('?') ? '&' : '?'}v=${now}`;
}

export class CaptchaService {
  constructor(private readonly deps: CaptchaDeps) {}

  async solve(ch: CaptchaChallenge, opts: SolveOptions = {}): Promise<SolveResult> {
    const image = await this.deps.fetchImageBase64(ch.imageUrl);
    let fallbackReason: string | undefined;

    if (this.deps.getMode() === 'auto' && !opts.forceManual) {
      const auto = await this.tryAuto(image);
      if (auto.ok) return { answer: { code: auto.text, randCode: ch.randCode }, via: 'auto' };
      fallbackReason = auto.reason;
      this.deps.notify('캡챠 입력이 필요합니다', `자동 풀이 실패: ${auto.reason} 앱에서 직접 입력해 주세요.`);
    }

    const code = await this.deps.askManual({
      context: ch.context,
      imageBase64: image,
      fallbackReason,
      reload: () => this.deps.fetchImageBase64(withCacheBuster(ch.imageUrl)),
    });
    if (code === null || code.trim() === '') return null;
    return { answer: { code: code.trim(), randCode: ch.randCode }, via: 'manual' };
  }

  private async tryAuto(image: string): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
    const id = this.deps.getSolverId();
    const key = await this.deps.getApiKey(id);
    if (!key) return { ok: false, reason: 'API 키가 설정되지 않았습니다.' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.deps.timeoutMs ?? 130_000);
    try {
      const text = await this.deps.createSolver(id, key).solveImage(image, controller.signal);
      return { ok: true, text };
    } catch (e) {
      return { ok: false, reason: e instanceof SolverError ? e.message : '알 수 없는 오류가 발생했습니다.' };
    } finally {
      clearTimeout(timer);
    }
  }
}
