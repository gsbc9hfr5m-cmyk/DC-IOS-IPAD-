/**
 * 차단, 제한, 이상 응답 감지 규칙 테이블 (spec 2-7).
 * ⚠️ 근거: docs/dc-protocol.md §6 (실측과 JS 분석). 새 응답 유형이 나오면 이 테이블에 추가한다.
 *
 * 두 단계로 판정한다.
 * 1) transportRules: HTTP 수준 (상태 코드, 본문 형식) → 중단해야 하는 응답은 DcError를 던진다.
 * 2) actionRules: 삭제 등 동작 응답 JSON의 result/cause → 항목 단위 결과로 바꾼다.
 */
import { DcError } from './errors';
import type { HttpResponse } from './http';

// ───────────────────────── 1) 전송 수준 ─────────────────────────

type TransportRule = {
  id: string;
  match: (res: HttpResponse) => boolean;
  toError: (res: HttpResponse) => DcError;
};

const looksLikeHtml = (t: string) => /^\s*</.test(t);

export const transportRules: readonly TransportRule[] = [
  {
    // 실측: 429 {"message":"Too Many Attempts."} (Laravel throttle)
    id: 'rate-limit-429',
    match: (r) => r.status === 429 || /Too Many Attempts/i.test(r.text.slice(0, 200)),
    toError: (r) =>
      new DcError('rateLimited', '요청이 너무 많아 잠시 막혔습니다.', { status: r.status, rule: 'rate-limit-429' }),
  },
  {
    // ❓ 미관찰. Cloudflare 등 봇 차단 페이지
    id: 'challenge-page',
    match: (r) => looksLikeHtml(r.text) && /(cf-chl|challenge-platform|Just a moment|Attention Required)/i.test(r.text),
    toError: (r) => new DcError('blocked', '디시가 자동 요청을 차단했습니다.', { status: r.status, rule: 'challenge-page' }),
  },
  {
    // 로그인 페이지로 튕기면 세션 만료
    id: 'session-redirect',
    match: (r) => /msign\.dcinside\.com\/login/.test(r.url) || (looksLikeHtml(r.text) && /id=["']loginProcess["']/.test(r.text)),
    toError: (r) => new DcError('sessionExpired', '로그인이 만료되었습니다.', { status: r.status, rule: 'session-redirect' }),
  },
  {
    // PC판으로 리다이렉트 → UA 설정 오류 (구조 변경과 같은 취급: 진행하면 안 된다)
    id: 'desktop-redirect',
    match: (r) => /\/\/(gall|gallog)\.dcinside\.com\//.test(r.url),
    toError: (r) =>
      new DcError('structureChanged', 'PC판 페이지로 이동되었습니다. 모바일 접속 설정을 확인해야 합니다.', {
        status: r.status,
        rule: 'desktop-redirect',
      }),
  },
  {
    id: 'forbidden-unknown',
    // 403이면서 "삭제된 게시물" 안내가 아닌 경우 → 차단 의심 (원문 페이지의 삭제 안내는 parsers에서 따로 처리)
    match: (r) => r.status === 403 && !/게시물 작성자가 삭제했거나 존재하지 않는/.test(r.text),
    toError: (r) => new DcError('blocked', '접근이 거부되었습니다 (403).', { status: r.status, rule: 'forbidden-unknown' }),
  },
  {
    id: 'server-error',
    match: (r) => r.status >= 500,
    toError: (r) => new DcError('network', `디시 서버 오류 (${r.status})`, { status: r.status, rule: 'server-error' }),
  },
];

/**
 * 중단해야 하는 응답이면 DcError를 던진다.
 * loginFlow: 로그인 과정 자체의 요청은 로그인 페이지가 정상 응답이므로 session-redirect 규칙을 건너뛴다.
 */
export function assertTransportOk(res: HttpResponse, opts: { loginFlow?: boolean } = {}): void {
  for (const rule of transportRules) {
    if (opts.loginFlow && rule.id === 'session-redirect') continue;
    if (rule.match(res)) throw rule.toError(res);
  }
}

/** JSON을 기대하는 요청: 위 규칙을 통과한 뒤 JSON이 아니면 구조 변경으로 본다. 빈 본문은 null. */
export function parseJsonOrThrow(res: HttpResponse, endpoint: string, opts: { loginFlow?: boolean } = {}): unknown {
  assertTransportOk(res, opts);
  const text = res.text.trim();
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new DcError('structureChanged', '응답이 예상한 JSON 형식이 아닙니다.', {
      endpoint,
      status: res.status,
      contentType: res.headers['content-type'] ?? '',
      bodyHead: text.slice(0, 80).replace(/\s+/g, ' '),
    });
  }
}

// ───────────────────────── 2) 동작 결과 ─────────────────────────

export type ActionVerdict =
  | { type: 'ok' } // result true (아직 검증 전)
  | { type: 'unverified'; reason: 'emptyBody' | 'noResultField' }
  | { type: 'captcha'; randCode?: string; imageUrl?: string }
  | { type: 'skip'; reason: 'delLimit' | 'commentNoti' | 'noPermission'; message: string }
  | { type: 'fail'; message: string };

type Json = Record<string, unknown>;
type ActionRule = { id: string; match: (j: Json) => boolean; verdict: (j: Json) => ActionVerdict };

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const isFalse = (v: unknown) => v === 0 || v === false || v === '0';
const isTrue = (v: unknown) => v === 1 || v === true || v === '1';

/** ⚠️ 권한 없음 문구는 미확인. 실제 응답을 수집하면 정규식에 추가한다. */
const NO_PERMISSION = /(권한이 없|삭제할 수 없|본인만|잘못된 접근)/;
const IP_BLOCK = /(통신사 IP|VPN IP|IP가 차단|차단된 IP|차단되었습니다)/;

export const actionRules: readonly ActionRule[] = [
  {
    id: 'bot-flag',
    match: (j) => isTrue(j.bot),
    verdict: () => {
      throw new DcError('blocked', '디시가 자동 요청으로 판단했습니다.', { rule: 'bot-flag' });
    },
  },
  {
    id: 'ip-block',
    match: (j) => isFalse(j.result) && IP_BLOCK.test(str(j.cause)),
    verdict: (j) => {
      throw new DcError('blocked', str(j.cause), { rule: 'ip-block' });
    },
  },
  {
    id: 'captcha',
    match: (j) => j.cause === 'captcha' || j.reason === 'limit_login',
    verdict: (j) => ({
      type: 'captcha',
      randCode: str(j.ran_code) || str(j.randCode) || str(j.rand_code) || undefined,
      imageUrl: str(j.code) || undefined,
    }),
  },
  {
    // 말머리 삭제 제한. del_limit_chk=1로 재요청하면 매니저 차단을 감수하게 되므로 절대 자동 진행하지 않는다.
    id: 'del-limit',
    match: (j) => j.cause === 'del_limit' || isTrue(j.del_limit),
    verdict: (j) => ({ type: 'skip', reason: 'delLimit', message: str(j.msg) || str(j.cause) }),
  },
  {
    // 공지글 댓글 5분 내 삭제 → 매니저 차단 경고. 자동 진행 금지.
    id: 'comment-noti',
    match: (j) => j.cause === 'comment_noti',
    verdict: (j) => ({ type: 'skip', reason: 'commentNoti', message: str(j.msg) }),
  },
  {
    id: 'no-permission',
    match: (j) => isFalse(j.result) && NO_PERMISSION.test(str(j.cause)),
    verdict: (j) => ({ type: 'skip', reason: 'noPermission', message: str(j.cause) }),
  },
  { id: 'success', match: (j) => isTrue(j.result), verdict: () => ({ type: 'ok' }) },
  { id: 'failure', match: (j) => isFalse(j.result), verdict: (j) => ({ type: 'fail', message: str(j.cause) || '알 수 없는 실패' }) },
];

/**
 * 동작 응답 판정. 실측: 이미 지운 항목을 다시 지우면 200에 빈 본문 → 성공으로 보지 않는다.
 */
export function classifyAction(json: unknown): ActionVerdict {
  if (json === null) return { type: 'unverified', reason: 'emptyBody' };
  if (typeof json !== 'object' || Array.isArray(json)) {
    throw new DcError('structureChanged', '동작 응답 형식이 예상과 다릅니다.', { got: Array.isArray(json) ? 'array' : typeof json });
  }
  const j = json as Json;
  for (const rule of actionRules) {
    if (rule.match(j)) return rule.verdict(j);
  }
  return { type: 'unverified', reason: 'noResultField' };
}
