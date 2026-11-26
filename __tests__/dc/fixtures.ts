/**
 * 가짜 응답. 실측한 응답의 "구조"(dc-protocol §3-3, §4-D)를 본떠 만들었고 실제 사용자 데이터는 없다.
 */
import type { HttpRequest, HttpResponse, HttpTransport } from '@/dc/http';

export const UID = 'tester01';
export const CSRF = 'a'.repeat(32);
export const BLOCK_KEY = 'k'.repeat(42);

export function gallogItem(over: Record<string, unknown> = {}) {
  return {
    check_comment: '0',
    cid: '12345',
    cno: '0',
    code: '79806',
    gall_code: '79806',
    gno: null,
    headnum: '123456',
    hit: null,
    ismember: null,
    memo: '',
    name: '테스터',
    nicktype: '00',
    no: '1001',
    pno: '9001',
    reg_date: null,
    subject: '테스트 글 &amp; 제목',
    total_comment: null,
    type: 'G',
    wdate: '2024.03.05',
    wtime: '13:45:10',
    ...over,
  };
}

export function gallogList(data: unknown[], over: { total?: number | string; last_page?: number; managerskill?: unknown } = {}) {
  return {
    gallog_info: {
      managerskill: 'managerskill' in over ? over.managerskill : true,
      total_cnt: 2,
      total_cnt_g: '1',
      total_cnt_m: '0',
      total_cnt_mini: '0',
      total_cnt_person: 0,
      name: '테스터',
    },
    gallog_list: {
      current_page: 1,
      data,
      from: 1,
      last_page: over.last_page ?? 1,
      next_page_url: null,
      per_page: 30,
      prev_page_url: null,
      to: data.length,
      total: over.total ?? data.length,
    },
  };
}

export function guestbookItem(over: Record<string, unknown> = {}) {
  return {
    category: '1',
    chk: '0',
    headnum: '55',
    hit: null,
    homepage: null,
    islevel: '9',
    ismember: '1234567',
    memo: '안녕하세요\n반가워요',
    name: '방문자',
    nicktype: '00',
    no: '77',
    reple: [],
    subject: null,
    user_id: 'visitor1',
    write_time: '2019.07.01 09:30:00',
    del_scope: null,
    ...over,
  };
}

export function guestbookList(data: unknown[], managerskill = true) {
  return {
    gallog_info: { allow_write: true, managerskill, total_cnt: data.length, use_block: '' },
    gallog_list: { current_page: 1, data, last_page: 1, per_page: 30, total: data.length },
  };
}

export const homeHtmlLoggedIn = `<html><body>
  <a href="https://msign.dcinside.com/logout?r_url=x">로그아웃</a>
  <a href="/gallog/${UID}">갤로그</a>
</body></html>`;

export const homeHtmlLoggedOut = `<html><body><a href="https://msign.dcinside.com/login?r_url=x">로그인</a></body></html>`;

export const gallogHtml = (owner = UID, viewer = UID) => `<html><head>
  <meta name="csrf-token" content="${CSRF}">
</head><body>
  <input type="hidden" id="g_id" value="${owner}">
  <input type="hidden" value="${viewer}" name="user_id" id="user_id">
  <select class="sel" onchange="javascript:guestBook_change(this.value);">
    <option value="2021">2021</option><option value="2019">2019</option><option value="2021">2021</option>
  </select>
</body></html>`;

export const loginPageHtml = `<meta name="csrf-token" content="${"s".repeat(32)}"><form id="loginProcess"><input type="hidden" name="conKey" id="conKey" value="initialconkey123"></form>`;

export const postViewHtml = `<div class="gallview-tit-box">
  <span class="tit">  테스트 제목  </span>
  <div class="btm"><ul class="ginfo2"><li>테스터</li><li>2024.03.05 13:45</li></ul></div>
</div>
<div class="gall-thum-btm-inner"><ul class="ginfo2"><li>조회수 1,234</li><li class="up-add">추천 <span>56</span></li></ul>
<div class="thum-txtin"><div><p>본문 <b>내용</b></p></div><br>둘째 줄</div></div>`;

export const deletedPostHtml = '<html><body>게시물 작성자가 삭제했거나 존재하지 않는 페이지입니다.</body></html>';

// ───────────────────────── mock transport ─────────────────────────

type Handler = (req: HttpRequest) => Partial<HttpResponse> & { json?: unknown };

export class MockTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];
  private readonly routes: { method: string; match: RegExp; handler: Handler }[] = [];

  on(method: 'GET' | 'POST', match: RegExp, handler: Handler | (Partial<HttpResponse> & { json?: unknown })) {
    this.routes.unshift({ method, match, handler: typeof handler === 'function' ? handler : () => handler });
    return this;
  }

  async send(req: HttpRequest): Promise<HttpResponse> {
    this.requests.push(req);
    const route = this.routes.find((r) => r.method === req.method && r.match.test(req.url));
    if (!route) throw new Error(`no mock route: ${req.method} ${req.url}`);
    const r = route.handler(req);
    return {
      status: r.status ?? 200,
      url: r.url ?? req.url,
      headers: r.headers ?? { 'content-type': r.json !== undefined ? 'application/json' : 'text/html' },
      text: r.text ?? (r.json !== undefined ? JSON.stringify(r.json) : ''),
    };
  }

  bodyOf(match: RegExp): URLSearchParams[] {
    return this.requests.filter((r) => match.test(r.url) && r.body).map((r) => new URLSearchParams(r.body));
  }
}
