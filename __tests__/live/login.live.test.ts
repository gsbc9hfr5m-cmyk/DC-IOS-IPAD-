// @ts-nocheck -- Node 전용 진단 도구 (node:https, Buffer). 앱 타입 검사 대상이 아니다.
/**
 * 실서버 로그인 점검 (평소 테스트에서는 건너뛴다).
 * tools/login-live.ps1 이 아이디/비밀번호를 입력받아 이 프로세스 환경변수로만 넘겨 실행한다.
 * 앱의 DcClient 코드를 그대로 쓰고, 전송 계층만 iOS(NSURLSession)처럼 동작하는 Node 구현으로 바꾼다:
 *  - 쿠키 보관 (도메인 단위)
 *  - 리다이렉트 자동 추적: 307/308은 메서드와 본문 유지, 301/302/303은 GET으로 바꿈
 * 읽기만 한다 (로그인 → 갤로그 첫 페이지 조회). 삭제 요청은 보내지 않는다.
 */
import * as https from 'node:https';

import { DcClient } from '@/dc/DcClient';
import type { HttpRequest, HttpResponse, HttpTransport } from '@/dc/http';
import { MOBILE_USER_AGENT } from '@/dc/config';

type Cookie = { domain: string; hostOnly: boolean; name: string; value: string };

class NodeCookieTransport implements HttpTransport {
  private cookies: Cookie[] = [];
  readonly hops: string[] = [];

  private cookieHeader(host: string): string {
    return this.cookies
      .filter((c) => (c.hostOnly ? host === c.domain : host === c.domain || host.endsWith(`.${c.domain}`)))
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  }

  private store(host: string, setCookies: string[] | undefined) {
    for (const sc of setCookies ?? []) {
      const [pair, ...attrs] = sc.split(';');
      const eq = pair!.indexOf('=');
      const name = pair!.slice(0, eq).trim();
      const value = pair!.slice(eq + 1).trim();
      const domAttr = attrs.map((a) => a.trim()).find((a) => /^domain=/i.test(a));
      const domain = domAttr ? domAttr.slice(7).replace(/^\./, '').toLowerCase() : host;
      this.cookies = this.cookies.filter((c) => !(c.name === name && c.domain === domain));
      if (value !== '' && value !== 'deleted') this.cookies.push({ domain, hostOnly: !domAttr, name, value });
    }
  }

  private once(method: string, url: string, body: string | undefined, headers: Record<string, string>) {
    const u = new URL(url);
    return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string }>((resolve, reject) => {
      const cookie = this.cookieHeader(u.hostname);
      const req = https.request(
        url,
        { method, headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { 'Content-Length': Buffer.byteLength(body) } : {}) }, timeout: 20_000 },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
        },
      );
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      if (body !== undefined) req.write(body);
      req.end();
    });
  }

  async send(req: HttpRequest): Promise<HttpResponse> {
    let method: string = req.method;
    let url = req.url;
    let body = req.body;
    const headers: Record<string, string> = {
      'User-Agent': MOBILE_USER_AGENT,
      Accept: req.method === 'POST' ? 'application/json, text/javascript, */*; q=0.01' : 'text/html,*/*',
      'Accept-Language': 'ko-KR,ko;q=0.9',
      ...(req.body !== undefined ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } : {}),
      ...req.headers,
    };
    for (let hop = 0; hop < 10; hop++) {
      const res = await this.once(method, url, body, headers);
      const host = new URL(url).hostname;
      const sc = res.headers['set-cookie'];
      this.store(host, Array.isArray(sc) ? sc : sc ? [sc] : undefined);
      const loc = res.headers.location;
      if (res.status >= 300 && res.status < 400 && typeof loc === 'string') {
        const next = new URL(loc, url).toString();
        this.hops.push(`${res.status} ${method} ${host}${new URL(url).pathname} → ${new URL(next).host}${new URL(next).pathname}`);
        if (res.status !== 307 && res.status !== 308 && method === 'POST') {
          method = 'GET';
          body = undefined;
          delete headers['Content-Type'];
        }
        url = next;
        continue;
      }
      if (url.includes('/login/access')) {
        this.hops.push(`access 응답: ${res.status} ${res.text.slice(0, 200).replace(/"Block_key":"[^"]*"/, '"Block_key":"(숨김)"')}`);
        this.hops.push(`access 보낸 헤더: ${Object.keys(headers).join(', ')}`);
      }
      const flat: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) flat[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
      return { status: res.status, url, headers: flat, text: res.text };
    }
    throw new Error('too many redirects');
  }
}

const id = process.env.DC_LIVE_ID ?? '';
const password = process.env.DC_LIVE_PW ?? '';
const live = process.env.DC_LIVE === '1' && id !== '' && password !== '' ? it : it.skip;

live(
  '실서버: 앱 코드로 로그인하고 갤로그 첫 페이지를 읽는다',
  async () => {
    const transport = new NodeCookieTransport();
    const out: string[] = [];
    const client = new DcClient({
      transport,
      onTrace: (t) => out.push(`${t.method} ${t.path} → ${t.status} (${t.ms}ms)${t.note ? ` ${t.note}` : ''}`),
    });
    let result: unknown;
    try {
      result = await client.login({ id, password });
    } catch (e) {
      result = { thrown: e instanceof Error ? `${e.name}: ${e.message} ${JSON.stringify((e as { detail?: unknown }).detail ?? '')}` : String(e) };
    }
    out.push(`로그인 결과: ${JSON.stringify(result)}`);
    if ((result as { status?: string }).status === 'ok') {
      try {
        const posts = await client.listGallog('G_all', 1);
        const comments = await client.listGallog('R_all', 1);
        out.push(`갤로그 글 1페이지: ${posts.items.length}개, 댓글 1페이지: ${comments.items.length}개`);
      } catch (e) {
        out.push(`갤로그 조회 실패: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    process.stdout.write(`\n===== 결과 =====\n${[...out, '--- 리다이렉트 ---', ...transport.hops].join('\n')}\n================\n`);
  },
  180_000,
);
