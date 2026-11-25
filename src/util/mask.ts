/**
 * 로그/디버그 기록용 마스킹 (spec 2-14, 2-16). 비밀번호, 쿠키, 토큰, API 키는 절대 남기지 않는다.
 */
const SENSITIVE_KEYS =
  /^(password|passwd|pw|gb_pw|code|conkey|con_key|block_key|_token|token|csrf|x-csrf-token|cookie|set-cookie|authorization|api_?key|clientkey|key|randcode|rand_code|captcha_code|otp_num|otp_data)$/i;

const MASK = '***';

/** URL은 호스트와 경로만 남긴다 (쿼리 제거) */
export function maskUrl(url: string): string {
  const m = /^[a-z]+:\/\/([^/?#]+)([^?#]*)/i.exec(url);
  return m ? `${m[1]}${m[2]}` : (url.split('?')[0] ?? url);
}

/** form 본문 'a=1&password=xx' → 'a=1&password=***' */
export function maskFormBody(body: string): string {
  return body
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      const k = eq < 0 ? pair : pair.slice(0, eq);
      return SENSITIVE_KEYS.test(decodeSafe(k)) ? `${k}=${MASK}` : pair;
    })
    .join('&');
}

/** 객체 안의 민감한 키를 재귀적으로 가린다 */
export function maskObject<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => maskObject(v)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.test(k) ? MASK : maskObject(v);
    }
    return out as T;
  }
  return value;
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
