import { DcClient, type TraceEntry } from '@/dc/DcClient';
import { DcError } from '@/dc/errors';
import { RateLimiter } from '@/dc/rateLimiter';

import * as F from './fixtures';

const instantLimiter = () =>
  new RateLimiter({ now: () => 0, sleep: async () => {} }, { minIntervalMs: 0, jitterMs: 0, cooldownMs: 75_000 });

function loggedInTransport() {
  return new F.MockTransport()
    .on('GET', /m\.dcinside\.com\/$/, { text: F.homeHtmlLoggedIn })
    .on('GET', /\/gallog\/tester01/, { text: F.gallogHtml() })
    .on('POST', /\/ajax\/access$/, { json: { result: true, Block_key: F.BLOCK_KEY } });
}

async function readyClient(t = loggedInTransport(), traces: TraceEntry[] = []) {
  const client = new DcClient({ transport: t, limiter: instantLimiter(), onTrace: (x) => traces.push(x) });
  expect(await client.restoreSession()).toBe(F.UID);
  return { client, t, traces };
}

async function codeOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof DcError ? e.code : `other:${String(e)}`;
  }
}

describe('세션', () => {
  it('로그인 상태면 uid와 csrf를 확보한다', async () => {
    const { client } = await readyClient();
    expect(client.currentUid).toBe(F.UID);
  });

  it('비로그인이면 null', async () => {
    const t = new F.MockTransport().on('GET', /m\.dcinside\.com\/$/, { text: F.homeHtmlLoggedOut });
    const client = new DcClient({ transport: t, limiter: instantLimiter() });
    expect(await client.restoreSession()).toBeNull();
    expect(await codeOf(client.listGallog('G_all', 1))).toBe('sessionExpired');
  });

  it('홈의 첫 갤로그 링크가 남의 것이어도 hidden user_id로 내 갤로그를 찾는다', async () => {
    const t = new F.MockTransport()
      .on('GET', /m\.dcinside\.com\/$/, { text: F.homeHtmlLoggedIn.replace(`/gallog/${F.UID}`, '/gallog/someone') })
      .on('GET', /\/gallog\/someone/, { text: F.gallogHtml('someone', F.UID) })
      .on('GET', /\/gallog\/tester01/, { text: F.gallogHtml() });
    const client = new DcClient({ transport: t, limiter: instantLimiter() });
    expect(await client.restoreSession()).toBe(F.UID);
  });
});

describe('목록', () => {
  it('csrf 헤더와 g_id를 보내고 결과를 파싱한다', async () => {
    const t = loggedInTransport().on('POST', /response-galloglist$/, { json: F.gallogList([F.gallogItem()]) });
    const { client } = await readyClient(t);
    const page = await client.listGallog('G_all', 3);
    expect(page.items).toHaveLength(1);
    const req = t.requests.at(-1)!;
    expect(req.headers?.['X-CSRF-TOKEN']).toBe(F.CSRF);
    expect(new URLSearchParams(req.body).get('g_id')).toBe(F.UID);
    expect(new URLSearchParams(req.body).get('page')).toBe('3');
  });

  it('본인 갤로그가 아니면 notOwner', async () => {
    const t = loggedInTransport().on('POST', /response-galloglist$/, { json: F.gallogList([], { managerskill: false }) });
    const { client } = await readyClient(t);
    expect(await codeOf(client.listGallog('G_all', 1))).toBe('notOwner');
  });

  it('구조가 바뀌면 structureChanged', async () => {
    const t = loggedInTransport().on('POST', /response-galloglist$/, { json: { data: [] } });
    const { client } = await readyClient(t);
    expect(await codeOf(client.listGallog('R_all', 1))).toBe('structureChanged');
  });

  it('429면 rateLimited와 대기 시간', async () => {
    const t = loggedInTransport().on('POST', /response-galloglist$/, { status: 429, json: { message: 'Too Many Attempts.' } });
    const { client } = await readyClient(t);
    try {
      await client.listGallog('G_all', 1);
      throw new Error('should throw');
    } catch (e) {
      expect((e as DcError).code).toBe('rateLimited');
      expect((e as DcError).retryAfterMs).toBe(75_000);
    }
  });

  it('갤러리 ID는 캐시한다', async () => {
    const t = loggedInTransport().on('POST', /list-direct$/, { json: { gall_id: 'comic_new6' } });
    const { client } = await readyClient(t);
    expect(await client.resolveGallId('79806', 'R')).toBe('comic_new6');
    expect(await client.resolveGallId('79806', 'R')).toBe('comic_new6');
    expect(t.requests.filter((r) => /list-direct/.test(r.url))).toHaveLength(1);
  });
});

describe('삭제', () => {
  it('access → log-del 순서로 매번 새 con_key를 쓴다', async () => {
    let n = 0;
    const t = loggedInTransport()
      .on('POST', /\/ajax\/access$/, () => ({ json: { result: true, Block_key: `key-${++n}`.padEnd(20, 'x') } }))
      .on('POST', /log-del$/, { json: { result: true } });
    const { client } = await readyClient(t);
    expect(await client.deleteGallogItem('1001')).toEqual({ type: 'ok' });
    expect(await client.deleteGallogItem('1002')).toEqual({ type: 'ok' });
    const dels = t.bodyOf(/log-del$/);
    expect(dels.map((b) => b.get('no'))).toEqual(['1001', '1002']);
    expect(dels[0]!.get('con_key')).not.toBe(dels[1]!.get('con_key'));
    expect(t.bodyOf(/\/ajax\/access$/).every((b) => b.get('token_verify') === 'gallogDel')).toBe(true);
  });

  it('del_limit 경고를 받으면 skip하고 del_limit_chk를 절대 보내지 않는다', async () => {
    const t = loggedInTransport().on('POST', /log-del$/, { json: { result: 0, cause: 'del_limit', msg: '공지' } });
    const { client } = await readyClient(t);
    expect(await client.deleteGallogItem('1001')).toMatchObject({ type: 'skip', reason: 'delLimit' });
    expect(t.requests.filter((r) => /log-del/.test(r.url))).toHaveLength(1);
    expect(t.requests.some((r) => r.body?.includes('del_limit_chk'))).toBe(false);
  });

  it('빈 응답은 성공이 아니라 unverified', async () => {
    const t = loggedInTransport().on('POST', /log-del$/, { text: '' });
    const { client } = await readyClient(t);
    expect(await client.deleteGallogItem('1001')).toEqual({ type: 'unverified', reason: 'emptyBody' });
  });

  it('trace에는 con_key와 csrf가 남지 않는다', async () => {
    const traces: TraceEntry[] = [];
    const t = loggedInTransport().on('POST', /log-del$/, { json: { result: true } });
    const { client } = await readyClient(t, traces);
    await client.deleteGallogItem('1001');
    const dump = JSON.stringify(traces);
    expect(dump).not.toContain(F.BLOCK_KEY);
    expect(dump).not.toContain(F.CSRF);
    expect(dump).toContain('m.dcinside.com/gallog/log-del');
  });

  it('원글이 삭제된 글은 deleted, 정상 글은 파싱', async () => {
    const t = loggedInTransport()
      .on('GET', /\/board\/gone\/1$/, { status: 403, text: F.deletedPostHtml })
      .on('GET', /\/board\/live\/2$/, { text: F.postViewHtml });
    const { client } = await readyClient(t);
    expect(await client.fetchPost('general', 'gone', '1')).toEqual({ status: 'deleted' });
    const live = await client.fetchPost('minor', 'live', '2');
    expect(live.status === 'ok' && live.view.recommends).toBe(56);
  });
});

describe('방명록', () => {
  it('연도 목록, 연도별 조회, 삭제', async () => {
    const t = loggedInTransport()
      .on('POST', /response-galloglistGb$/, { json: F.guestbookList([F.guestbookItem()]) })
      .on('POST', /guestbook_del$/, { json: { result: true } });
    const { client } = await readyClient(t);
    expect(await client.listGuestbookYears()).toEqual([2021, 2019]);
    const page = await client.listGuestbook(2019, 1);
    expect(page.items[0]!.year).toBe(2019);
    expect(new URLSearchParams(t.bodyOf(/galloglistGb$/)[0]!.toString()).get('year')).toBe('2019');
    expect(await client.deleteGuestbook('77', true)).toEqual({ type: 'ok' });
    const del = t.bodyOf(/guestbook_del$/)[0]!;
    expect(del.get('del_type')).toBe('comment');
    expect(t.bodyOf(/\/ajax\/access$/).at(-1)!.get('token_verify')).toBe('guestbookDel');
  });

  it('갤로그를 다시 읽을 때 로그인이 풀려 있으면 sessionExpired', async () => {
    const t = loggedInTransport();
    const { client } = await readyClient(t);
    t.on('GET', /\/gallog\/tester01/, { text: F.gallogHtml(F.UID, '') });
    expect(await codeOf(client.listGuestbookYears())).toBe('sessionExpired');
  });
});

describe('로그인', () => {
  const creds = { id: 'tester01', password: 'pw-secret' };

  it('캡챠를 요구하면 이미지와 randCode를 돌려준다', async () => {
    const t = new F.MockTransport()
      .on('GET', /msign\.dcinside\.com\/login/, { text: F.loginPageHtml })
      .on('POST', /\/login\/access$/, { json: { result: 0, reason: 'limit_login', code: 'https://msign.dcinside.com/captcha?x', randCode: 'R9' } });
    const client = new DcClient({ transport: t, limiter: instantLimiter() });
    expect(await client.login(creds)).toEqual({ status: 'captcha', imageUrl: 'https://msign.dcinside.com/captcha?x', randCode: 'R9', wrongCode: false });
    // code 키를 두 번 보낸다 (원본 JS 재현)
    expect(t.bodyOf(/\/login\/access$/)[0]!.getAll('code')).toEqual(['tester01', '']);
  });

  it('성공하면 세션을 확인하고 uid를 돌려준다. 비밀번호는 trace에 없다', async () => {
    const traces: TraceEntry[] = [];
    const t = loggedInTransport()
      .on('GET', /msign\.dcinside\.com\/login/, { text: F.loginPageHtml })
      .on('POST', /\/login\/access$/, { json: { result: 1, Block_key: F.BLOCK_KEY } })
      .on('POST', /msign\.dcinside\.com\/login$/, { text: '<html>redirect</html>', url: 'https://m.dcinside.com/' });
    const client = new DcClient({ transport: t, limiter: instantLimiter(), onTrace: (x) => traces.push(x) });
    expect(await client.login(creds, { code: 'abcd', randCode: 'R9' })).toEqual({ status: 'ok', uid: F.UID });
    const submit = t.bodyOf(/msign\.dcinside\.com\/login$/)[0]!;
    expect(submit.get('conKey')).toBe(F.BLOCK_KEY);
    expect(submit.get('password')).toBe('pw-secret');
    expect(JSON.stringify(traces)).not.toContain('pw-secret');
  });

  it('OTP 계정과 실패 메시지', async () => {
    const base = () =>
      new F.MockTransport()
        .on('GET', /m\.dcinside\.com\/$/, { text: F.homeHtmlLoggedOut })
        .on('GET', /msign\.dcinside\.com\/login/, { text: F.loginPageHtml })
        .on('POST', /\/login\/access$/, { json: { result: 1, Block_key: F.BLOCK_KEY } });
    const otp = base().on('POST', /msign\.dcinside\.com\/login$/, { text: '<input id="otp_num">' });
    expect(await new DcClient({ transport: otp, limiter: instantLimiter() }).login(creds)).toEqual({ status: 'otp' });
    const bad = base().on('POST', /msign\.dcinside\.com\/login$/, { text: '<script>alert("비밀번호가 틀렸습니다.")</script>' });
    expect(await new DcClient({ transport: bad, limiter: instantLimiter() }).login(creds)).toEqual({
      status: 'failed',
      message: '비밀번호가 틀렸습니다.',
    });
  });

  it("실패하면 디시가 보여준 안내 문구를 그대로 돌려준다", async () => {
    const t = new F.MockTransport()
      .on("GET", /msign\.dcinside\.com\/login/, { text: F.loginPageHtml })
      .on("POST", /\/login\/access$/, { json: { result: true, Block_key: "b".repeat(24) } })
      .on("POST", /msign\.dcinside\.com\/login$/, {
        text: F.loginPageHtml + '<div class="alert-message"> 식별 코드 또는 비밀번호가 일치하지 않습니다. <span class="point-red">확인 후 다시 입력</span>해 주세요. </div>',
      });
    const client = new DcClient({ transport: t, limiter: instantLimiter() });
    expect(await client.login(creds)).toEqual({ status: "failed", message: "식별 코드 또는 비밀번호가 일치하지 않습니다. 확인 후 다시 입력해 주세요." });
    // msign csrf가 있으면 access 요청에 붙인다
    expect(t.requests.find((r) => /login\/access/.test(r.url))?.headers?.["X-CSRF-TOKEN"]).toBe("s".repeat(32));
  });

  it('로그인 페이지 구조가 바뀌면 structureChanged', async () => {
    const t = new F.MockTransport().on('GET', /msign\.dcinside\.com\/login/, { text: '<html></html>' });
    expect(await codeOf(new DcClient({ transport: t, limiter: instantLimiter() }).login(creds))).toBe('structureChanged');
  });
});
