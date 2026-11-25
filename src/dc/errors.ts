/**
 * DcClient가 던지는 오류. 엔진은 code로 분기한다.
 * - 중단 계열(halt): rateLimited, blocked, structureChanged → 작업 전체를 멈춘다
 * - 세션 계열: sessionExpired → 재로그인 후 재시도
 * - 사용자 개입: captchaRequired
 */
export type DcErrorCode =
  | 'network'
  | 'rateLimited'
  | 'blocked'
  | 'structureChanged'
  | 'sessionExpired'
  | 'captchaRequired'
  | 'loginFailed'
  | 'otpRequired'
  | 'notOwner';

export class DcError extends Error {
  readonly code: DcErrorCode;
  /** 화면에 그대로 보여도 되는 디버그 요약 (민감정보 없음) */
  readonly debug: Record<string, unknown>;
  /** rateLimited/blocked일 때 권장 대기 시간 */
  readonly retryAfterMs?: number;

  constructor(code: DcErrorCode, message: string, debug: Record<string, unknown> = {}, retryAfterMs?: number) {
    super(message);
    this.name = 'DcError';
    this.code = code;
    this.debug = debug;
    this.retryAfterMs = retryAfterMs;
  }

  /** 이 오류가 나면 작업 전체를 멈춰야 하는가 */
  get halts(): boolean {
    return this.code === 'rateLimited' || this.code === 'blocked' || this.code === 'structureChanged';
  }
}

export function isDcError(e: unknown): e is DcError {
  return e instanceof DcError;
}
