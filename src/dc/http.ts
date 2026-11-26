/**
 * 전송 계층. 테스트에서는 HttpTransport를 mock으로 바꿔 끼운다.
 * 쿠키: iOS의 fetch는 NSHTTPCookieStorage를 공유하므로 credentials: 'include'로 세션 쿠키가 유지된다.
 * ⚠️ 로그인 쿠키 이름/만료는 미확인(dc-protocol §9-1). 세션은 쿠키를 직접 읽지 않고 응답으로 판정한다.
 */
import { arrayBufferToBase64 } from '@/util/base64';

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

const MAX_REDIRECTS = 10;

/** 3xx + Location이면 다음 절대 URL, 아니면 null */
export function redirectTarget(status: number, location: string | undefined, base: string): string | null {
  if (status < 300 || status >= 400 || status === 304 || !location) return null;
  const loc = location.trim();
  if (/^https?:\/\//i.test(loc)) return loc;
  const m = /^(https?:)\/\/([^/?#]+)([^?#]*)/i.exec(base);
  if (!m) return null;
  const [, scheme, host, path] = m;
  if (loc.startsWith('//')) return `${scheme}${loc}`;
  if (loc.startsWith('/')) return `${scheme}//${host}${loc}`;
  const dir = (path ?? '').replace(/[^/]*$/, '') || '/';
  return `${scheme}//${host}${dir}${loc}`;
}

export class FetchTransport implements HttpTransport {
  constructor(private readonly timeoutMs = 20_000) {}

  /**
   * 리다이렉트는 직접 한 단계씩 따라간다.
   * ⚠️ 실측(2026-11-26): expo/fetch(iOS)는 요청 시작 시점의 쿠키를 Cookie 헤더로 고정해 넣고,
   * 자동 리다이렉트 때 그 헤더를 그대로 복사한다. 로그인 SSO(msign → sso → msign, 307)에서
   * 중간에 받은 쿠키가 실리지 않아 "재이동이 너무 많음"으로 실패했다.
   * 단계마다 새 요청을 만들면 그때의 쿠키 저장소(HTTPCookieStorage)로 다시 계산된다.
   */
  async send(req: HttpRequest): Promise<HttpResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let method: HttpRequest['method'] = req.method;
      let url = req.url;
      let body = req.body;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const res = await fetch(url, {
          method,
          body,
          credentials: 'include',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'User-Agent': MOBILE_USER_AGENT,
            Accept: method === 'POST' ? 'application/json, text/javascript, */*; q=0.01' : 'text/html,*/*',
            'Accept-Language': 'ko-KR,ko;q=0.9',
            ...(body !== undefined ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } : {}),
            ...req.headers,
          },
        });
        const headers: Record<string, string> = {};
        res.headers.forEach((v, k) => {
          headers[k.toLowerCase()] = v;
        });
        const next = redirectTarget(res.status, headers.location, url);
        if (next) {
          await res.text().catch(() => '');
          // 307/308은 메서드와 본문을 유지하고, 나머지(301/302/303)는 GET으로 바꾼다 (브라우저와 같음)
          if (res.status !== 307 && res.status !== 308) {
            method = 'GET';
            body = undefined;
          }
          url = next;
          continue;
        }
        return { status: res.status, url: res.url || url, headers, text: await res.text() };
      }
      throw new Error('too many redirects');
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 캡챠 이미지처럼 세션 쿠키가 필요한 이미지를 받아 base64로 돌려준다. */
export async function fetchImageBase64(url: string, timeoutMs = 15_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      credentials: 'include',
      signal: controller.signal,
      headers: { 'User-Agent': MOBILE_USER_AGENT, Accept: 'image/*' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return arrayBufferToBase64(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

/** application/x-www-form-urlencoded 인코딩. 같은 키를 두 번 보내야 하는 경우가 있어 배열을 받는다. */
export function formEncode(pairs: readonly (readonly [string, string])[]): string {
  return pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}
