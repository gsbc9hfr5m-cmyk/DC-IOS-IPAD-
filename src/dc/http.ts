/**
 * 전송 계층. 테스트에서는 HttpTransport를 mock으로 바꿔 끼운다.
 * 쿠키: iOS의 fetch는 NSHTTPCookieStorage를 공유하므로 credentials: 'include'로 세션 쿠키가 유지된다.
 * ⚠️ 로그인 쿠키 이름/만료는 미확인(dc-protocol §9-1). 세션은 쿠키를 직접 읽지 않고 응답으로 판정한다.
 */
import { MOBILE_USER_AGENT } from './config';

export type HttpRequest = {
  method: 'GET' | 'POST';
  url: string;
  /** application/x-www-form-urlencoded 본문 (이미 인코딩된 문자열) */
  body?: string;
  headers?: Record<string, string>;
};

export type HttpResponse = {
  status: number;
  /** 리다이렉트 후 최종 URL */
  url: string;
  /** 헤더 이름은 소문자 */
  headers: Record<string, string>;
  text: string;
};

export interface HttpTransport {
  send(req: HttpRequest): Promise<HttpResponse>;
}

export class FetchTransport implements HttpTransport {
  constructor(private readonly timeoutMs = 20_000) {}

  async send(req: HttpRequest): Promise<HttpResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(req.url, {
        method: req.method,
        body: req.body,
        credentials: 'include',
        signal: controller.signal,
        headers: {
          'User-Agent': MOBILE_USER_AGENT,
          Accept: req.method === 'POST' ? 'application/json, text/javascript, */*; q=0.01' : 'text/html,*/*',
          'Accept-Language': 'ko-KR,ko;q=0.9',
          ...(req.body !== undefined ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } : {}),
          ...req.headers,
        },
      });
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
      return { status: res.status, url: res.url || req.url, headers, text: await res.text() };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** application/x-www-form-urlencoded 인코딩. 같은 키를 두 번 보내야 하는 경우가 있어 배열을 받는다. */
export function formEncode(pairs: readonly (readonly [string, string])[]): string {
  return pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}
