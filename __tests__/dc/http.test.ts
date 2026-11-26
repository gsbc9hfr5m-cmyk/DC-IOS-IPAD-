import { FetchTransport, redirectTarget } from '@/dc/http';

describe('redirectTarget', () => {
  it('3xx + Location만 다음 주소로 본다', () => {
    expect(redirectTarget(200, 'https://x/', 'https://a.com/p')).toBeNull();
    expect(redirectTarget(304, '/x', 'https://a.com/p')).toBeNull();
    expect(redirectTarget(302, undefined, 'https://a.com/p')).toBeNull();
    expect(redirectTarget(307, 'https://sso.dcinside.com/auth/?t=1', 'https://msign.dcinside.com/login')).toBe('https://sso.dcinside.com/auth/?t=1');
    expect(redirectTarget(302, '/login', 'https://sso.dcinside.com/auth/?t=1')).toBe('https://sso.dcinside.com/login');
    expect(redirectTarget(302, '//m.dcinside.com/', 'https://msign.dcinside.com/login')).toBe('https://m.dcinside.com/');
    expect(redirectTarget(302, 'next', 'https://a.com/dir/page')).toBe('https://a.com/dir/next');
  });
});

describe('FetchTransport (리다이렉트 직접 추적)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function mockFetch(responses: { status: number; location?: string; text?: string }[]) {
    const calls: { url: string; init: RequestInit }[] = [];
    globalThis.fetch = jest.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const r = responses.shift()!;
      return {
        status: r.status,
        url: '',
        headers: new Map(r.location ? [['Location', r.location]] : []) as unknown as Headers,
        text: async () => r.text ?? '',
      } as unknown as Response;
    }) as unknown as typeof fetch;
    return calls;
  }

  it('로그인 SSO: 307은 POST와 본문을 유지하고, 매 단계 새 요청을 보낸다', async () => {
    const calls = mockFetch([
      { status: 307, location: 'https://sso.dcinside.com/auth/?x=1' },
      { status: 307, location: 'https://msign.dcinside.com/login' },
      { status: 200, text: 'ok' },
    ]);
    const res = await new FetchTransport().send({ method: 'POST', url: 'https://msign.dcinside.com/login', body: 'a=1' });
    expect(res).toMatchObject({ status: 200, url: 'https://msign.dcinside.com/login', text: 'ok' });
    expect(calls.map((c) => [c.init.method, c.url, c.init.body])).toEqual([
      ['POST', 'https://msign.dcinside.com/login', 'a=1'],
      ['POST', 'https://sso.dcinside.com/auth/?x=1', 'a=1'],
      ['POST', 'https://msign.dcinside.com/login', 'a=1'],
    ]);
    // 자동 추적을 끄고, Cookie 헤더를 직접 넣지 않는다 (iOS 쿠키 저장소가 단계마다 계산)
    for (const c of calls) {
      expect(c.init.redirect).toBe('manual');
      expect(Object.keys(c.init.headers as Record<string, string>).map((k) => k.toLowerCase())).not.toContain('cookie');
    }
  });

  it('302/303은 GET으로 바꾸고 본문을 버린다', async () => {
    const calls = mockFetch([{ status: 302, location: '/home' }, { status: 200, text: 'home' }]);
    const res = await new FetchTransport().send({ method: 'POST', url: 'https://m.dcinside.com/x', body: 'a=1' });
    expect(res.text).toBe('home');
    expect(calls[1]).toMatchObject({ url: 'https://m.dcinside.com/home', init: { method: 'GET', body: undefined } });
    expect((calls[1]!.init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('무한 리다이렉트는 오류로 끝낸다', async () => {
    mockFetch(Array.from({ length: 20 }, () => ({ status: 307, location: 'https://msign.dcinside.com/login' })));
    await expect(new FetchTransport().send({ method: 'GET', url: 'https://msign.dcinside.com/login' })).rejects.toThrow('too many redirects');
  });
});
