import { DcError } from '@/dc/errors';
import type { HttpResponse } from '@/dc/http';
import { RateLimiter, type Clock } from '@/dc/rateLimiter';
import { assertTransportOk, classifyAction, parseJsonOrThrow } from '@/dc/rules';
import { maskFormBody, maskObject, maskUrl } from '@/util/mask';

const res = (over: Partial<HttpResponse>): HttpResponse => ({
  status: 200,
  url: 'https://m.dcinside.com/ajax/response-galloglist',
  headers: { 'content-type': 'application/json' },
  text: '{}',
  ...over,
});

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof DcError ? e.code : 'other';
  }
}

describe('전송 수준 규칙', () => {
  it('429와 Too Many Attempts는 rateLimited', () => {
    expect(codeOf(() => assertTransportOk(res({ status: 429, text: '{"message":"Too Many Attempts."}' })))).toBe('rateLimited');
    expect(codeOf(() => assertTransportOk(res({ text: '{"message":"Too Many Attempts."}' })))).toBe('rateLimited');
  });

  it('봇 차단 페이지는 blocked', () => {
    expect(codeOf(() => assertTransportOk(res({ status: 503, text: '<html>Just a moment...</html>' })))).toBe('blocked');
  });

  it('로그인 페이지로 튕기면 sessionExpired', () => {
    expect(codeOf(() => assertTransportOk(res({ url: 'https://msign.dcinside.com/login?r_url=x', text: '<html></html>' })))).toBe('sessionExpired');
  });

  it('PC판 리다이렉트는 구조 변경으로 멈춘다', () => {
    expect(codeOf(() => assertTransportOk(res({ url: 'https://gallog.dcinside.com/tester01', text: '<html></html>' })))).toBe('structureChanged');
  });

  it('403: 삭제된 게시글 안내가 아니면 차단 의심', () => {
    expect(codeOf(() => assertTransportOk(res({ status: 403, text: '<html>denied</html>' })))).toBe('blocked');
    expect(codeOf(() => assertTransportOk(res({ status: 403, text: '게시물 작성자가 삭제했거나 존재하지 않는 페이지입니다' })))).toBeNull();
  });

  it('JSON이 아니면 구조 변경, 빈 본문은 null', () => {
    expect(codeOf(() => parseJsonOrThrow(res({ text: '<html>점검중</html>' }), 'x'))).toBe('structureChanged');
    expect(parseJsonOrThrow(res({ text: '' }), 'x')).toBeNull();
    expect(parseJsonOrThrow(res({ text: '{"result":true}' }), 'x')).toEqual({ result: true });
  });
});

describe('동작 결과 규칙', () => {
  it('성공과 미확인', () => {
    expect(classifyAction({ result: true })).toEqual({ type: 'ok' });
    expect(classifyAction({ result: 1 })).toEqual({ type: 'ok' });
    // 실측: 이미 지운 항목 재삭제 → 200 빈 본문. 성공으로 보지 않는다.
    expect(classifyAction(null)).toEqual({ type: 'unverified', reason: 'emptyBody' });
    expect(classifyAction({ foo: 1 })).toEqual({ type: 'unverified', reason: 'noResultField' });
  });

  it('캡챠', () => {
    expect(classifyAction({ result: 0, cause: 'captcha', ran_code: 'r1' })).toMatchObject({ type: 'captcha', randCode: 'r1' });
  });

  it('매니저 차단 경고는 skip (자동 진행 금지)', () => {
    expect(classifyAction({ result: 0, cause: 'del_limit', msg: '공지' })).toEqual({ type: 'skip', reason: 'delLimit', message: '공지' });
    expect(classifyAction({ result: 0, cause: 'x', del_limit: true })).toMatchObject({ type: 'skip', reason: 'delLimit' });
    expect(classifyAction({ result: 0, cause: 'comment_noti', msg: '도배' })).toMatchObject({ type: 'skip', reason: 'commentNoti' });
  });

  it('권한 없음은 skip, 그 밖의 실패는 fail', () => {
    expect(classifyAction({ result: 0, cause: '삭제 권한이 없습니다.' })).toMatchObject({ type: 'skip', reason: 'noPermission' });
    expect(classifyAction({ result: 0, cause: '잠시 후 다시' })).toEqual({ type: 'fail', message: '잠시 후 다시' });
  });

  it('IP 차단과 봇 판정은 작업을 멈춘다', () => {
    expect(codeOf(() => classifyAction({ result: 0, cause: '통신사 IP는 이용할 수 없습니다' }))).toBe('blocked');
    expect(codeOf(() => classifyAction({ result: 0, bot: 1, cause: 'x' }))).toBe('blocked');
  });

  it('배열 같은 엉뚱한 응답은 구조 변경', () => {
    expect(codeOf(() => classifyAction([1, 2]))).toBe('structureChanged');
  });

  it('halts 플래그', () => {
    expect(new DcError('rateLimited', '').halts).toBe(true);
    expect(new DcError('structureChanged', '').halts).toBe(true);
    expect(new DcError('sessionExpired', '').halts).toBe(false);
  });
});

describe('RateLimiter', () => {
  function fakeClock() {
    let t = 1_000_000;
    const sleeps: number[] = [];
    const clock: Clock = {
      now: () => t,
      sleep: async (ms) => {
        sleeps.push(ms);
        t += ms;
      },
    };
    return { clock, sleeps, advance: (ms: number) => (t += ms) };
  }

  it('최소 간격과 지터를 지킨다', async () => {
    const { clock, sleeps } = fakeClock();
    const rl = new RateLimiter(clock, { minIntervalMs: 4000, jitterMs: 3000, random: () => 0.5 });
    await rl.acquire();
    await rl.acquire();
    await rl.acquire();
    expect(sleeps).toEqual([5500, 5500]);
  });

  it('남은 한도가 적으면 창 하나만큼 쉰다', async () => {
    const { clock, sleeps } = fakeClock();
    const rl = new RateLimiter(clock, { minIntervalMs: 0, jitterMs: 0, windowMs: 60_000, reserve: 5 });
    await rl.acquire();
    rl.observe({ 'x-ratelimit-remaining': '4' });
    await rl.acquire();
    expect(sleeps).toEqual([60_000]);
  });

  it('429가 반복되면 지수 백오프 (상한 있음)', () => {
    const { clock } = fakeClock();
    const rl = new RateLimiter(clock, { cooldownMs: 75_000, maxBackoffMs: 200_000 });
    expect(rl.penalize()).toBe(75_000);
    expect(rl.penalize()).toBe(150_000);
    expect(rl.penalize()).toBe(200_000);
    rl.observe({ 'x-ratelimit-remaining': '19' });
    expect(rl.penalize()).toBe(75_000);
  });
});

describe('마스킹', () => {
  it('form 본문의 비밀값을 가린다', () => {
    const masked = maskFormBody('code=myid&password=secret&con_key=abc&no=1001&token_verify=gallogDel');
    expect(masked).not.toContain('secret');
    expect(masked).not.toContain('abc');
    expect(masked).not.toContain('myid');
    expect(masked).toContain('no=1001');
    expect(masked).toContain('token_verify=gallogDel');
  });

  it('URL 쿼리를 지우고, 객체의 민감 키를 가린다', () => {
    expect(maskUrl('https://m.dcinside.com/gallog/x?menu=U&page=2')).toBe('m.dcinside.com/gallog/x');
    expect(maskObject({ a: 1, apiKey: 'k', nested: { Cookie: 'c', ok: 'y' } })).toEqual({ a: 1, apiKey: '***', nested: { Cookie: '***', ok: 'y' } });
  });
});
