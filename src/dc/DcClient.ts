/**
 * 디시인사이드 프로토콜 클라이언트.
 * - 프로토콜 세부(경로, 파라미터, 응답 구조, 차단 규칙)는 전부 src/dc/ 안에 격리한다.
 * - 이 클래스는 "한 번의 요청 → 검증된 결과"만 책임진다. 큐, 재시도, 백업, 보호 목록은 엔진(6단계)의 일이다.
 * - 비밀번호와 토큰은 trace에 남기지 않는다 (maskFormBody).
 *
 * ⚠️ 로그인 제출(/login) 이후 동작은 실요청으로 검증하지 못했다 (dc-protocol §2-3).
 *    성공 여부는 쿠키가 아니라 로그인 후 페이지(로그아웃 링크, 내 갤로그 링크)로 판정한다.
 */
import { DC_HOSTS, DC_PATHS, GALLOG_MENU, TOKEN_VERIFY, VIEW_BASE, type GalleryType } from './config';
import { DcError } from './errors';
import { FetchTransport, formEncode, type HttpRequest, type HttpResponse, type HttpTransport } from './http';
import {
  isDeletedPostPage,
  parseAccessKey,
  parseCsrfToken,
  parseGallogList,
  parseGuestbookList,
  parseGuestbookYears,
  parseHiddenInput,
  parseListDirect,
  parseLoggedInUid,
  parseLoginFailureMessage,
  parsePostView,
  type GallogPage,
  type GuestbookPage,
  type PostView,
} from './parsers';
import { RateLimiter } from './rateLimiter';
import { assertTransportOk, classifyAction, parseJsonOrThrow, type ActionVerdict } from './rules';
import { maskFormBody, maskUrl } from '@/util/mask';

export type TraceEntry = {
  at: number;
  method: string;
  /** 호스트 + 경로 (쿼리 제거) */
  path: string;
  status: number;
  ms: number;
  /** 마스킹된 요청 본문 */
  body?: string;
  /** 파싱 결과 요약 */
  note?: string;
};

export type DcClientOptions = {
  transport?: HttpTransport;
  limiter?: RateLimiter;
  onTrace?: (t: TraceEntry) => void;
  now?: () => number;
};

export type Credentials = { id: string; password: string };
export type CaptchaAnswer = { code: string; randCode: string };

export type LoginResult =
  | { status: 'ok'; uid: string }
  | { status: 'captcha'; imageUrl: string; randCode: string; wrongCode: boolean }
  | { status: 'otp' }
  | { status: 'failed'; message: string };

export type GallogListMenu = typeof GALLOG_MENU.postsAll | typeof GALLOG_MENU.commentsAll;

export type PostFetchResult = { status: 'ok'; view: PostView } | { status: 'deleted' };

export class DcClient {
  private readonly transport: HttpTransport;
  readonly limiter: RateLimiter;
  private readonly onTrace?: (t: TraceEntry) => void;
  private readonly now: () => number;

  private uid: string | null = null;
  private csrf: string | null = null;
  private readonly gallIdCache = new Map<string, string>();

  constructor(opts: DcClientOptions = {}) {
    this.transport = opts.transport ?? new FetchTransport();
    this.limiter = opts.limiter ?? new RateLimiter();
    this.onTrace = opts.onTrace;
    this.now = opts.now ?? Date.now;
  }

  get currentUid(): string | null {
    return this.uid;
  }

  // ───────────────────────── 공통 요청 ─────────────────────────

  private async send(req: HttpRequest, note?: (res: HttpResponse) => string): Promise<HttpResponse> {
    await this.limiter.acquire();
    const started = this.now();
    let res: HttpResponse;
    try {
      res = await this.transport.send(req);
    } catch (e) {
      // 통신 실패도 디버그 기록에 남긴다 (status 0)
      this.trace(req, { status: 0, url: req.url, headers: {}, text: '' }, started, `network: ${String(e).slice(0, 80)}`);
      throw new DcError('network', '네트워크 오류가 발생했습니다.', { path: maskUrl(req.url), error: String(e).slice(0, 120) });
    }
    this.limiter.observe(res.headers);
    if (res.status === 429) {
      const wait = this.limiter.penalize();
      this.trace(req, res, started, 'rate-limited');
      throw new DcError('rateLimited', '요청이 너무 많아 잠시 막혔습니다.', { path: maskUrl(req.url) }, wait);
    }
    this.trace(req, res, started, note?.(res));
    return res;
  }

  private trace(req: HttpRequest, res: HttpResponse, started: number, note?: string) {
    this.onTrace?.({
      at: started,
      method: req.method,
      path: maskUrl(req.url),
      status: res.status,
      ms: this.now() - started,
      body: req.body ? maskFormBody(req.body) : undefined,
      note,
    });
  }

  private ajaxHeaders(): Record<string, string> {
    return {
      'X-Requested-With': 'XMLHttpRequest',
      ...(this.csrf ? { 'X-CSRF-TOKEN': this.csrf } : {}),
      Referer: this.uid ? `${DC_HOSTS.mobile}${DC_PATHS.gallogPage(this.uid)}` : `${DC_HOSTS.mobile}/`,
    };
  }

  private async postJson(path: string, pairs: readonly (readonly [string, string])[]): Promise<unknown> {
    const res = await this.send({
      method: 'POST',
      url: `${DC_HOSTS.mobile}${path}`,
      body: formEncode(pairs),
      headers: this.ajaxHeaders(),
    });
    return parseJsonOrThrow(res, path);
  }

  private requireSession(): string {
    if (!this.uid || !this.csrf) throw new DcError('sessionExpired', '로그인이 필요합니다.');
    return this.uid;
  }

  // ───────────────────────── 세션 ─────────────────────────

  /**
   * 현재 쿠키로 로그인돼 있는지 확인하고, 갤로그 페이지에서 CSRF 토큰을 받는다.
   * 로그인 상태가 아니면 null.
   */
  async restoreSession(): Promise<string | null> {
    const home = await this.send({ method: 'GET', url: `${DC_HOSTS.mobile}/` });
    assertTransportOk(home);
    const candidate = parseLoggedInUid(home.text);
    if (!candidate) return this.clearSession();
    // 홈의 갤로그 링크는 추정값이다. 갤로그 페이지의 hidden user_id(로그인한 사용자)로 확정한다.
    let gallog = await this.fetchGallogPage(candidate);
    if (!gallog.loggedInUid) return this.clearSession();
    if (gallog.loggedInUid !== candidate) gallog = await this.fetchGallogPage(gallog.loggedInUid);
    if (gallog.loggedInUid !== gallog.ownerUid) {
      throw new DcError('notOwner', '로그인한 계정의 갤로그를 찾지 못했습니다.');
    }
    this.uid = gallog.ownerUid;
    this.csrf = gallog.csrf;
    return this.uid;
  }

  private clearSession(): null {
    this.uid = null;
    this.csrf = null;
    return null;
  }

  private async fetchGallogPage(uid: string, query = '') {
    const res = await this.send({ method: 'GET', url: `${DC_HOSTS.mobile}${DC_PATHS.gallogPage(uid)}${query}` });
    assertTransportOk(res);
    const csrf = parseCsrfToken(res.text);
    if (!csrf) throw new DcError('structureChanged', '갤로그 페이지에서 보안 토큰을 찾지 못했습니다.', { endpoint: 'gallog' });
    return {
      html: res.text,
      csrf,
      ownerUid: parseHiddenInput(res.text, 'g_id') ?? uid,
      loggedInUid: parseHiddenInput(res.text, 'user_id') || null,
    };
  }

  /** 내 갤로그 페이지를 다시 읽고 CSRF를 갱신한다. 세션이 풀렸으면 sessionExpired. */
  private async loadOwnGallogPage(query = ''): Promise<string> {
    const uid = this.requireSession();
    const page = await this.fetchGallogPage(uid, query);
    if (page.loggedInUid !== uid) {
      this.clearSession();
      throw new DcError('sessionExpired', '로그인이 만료되었습니다.');
    }
    this.csrf = page.csrf;
    return page.html;
  }

  /**
   * 로그인. 흐름 (dc-protocol §2):
   * 1) GET msign /login → conKey
   * 2) POST /login/access (token_verify=dc_login) → Block_key, 또는 캡챠 요구
   * 3) POST /login (폼 제출)
   * 4) 모바일 홈에서 로그인 상태 확인
   */
  async login(creds: Credentials, captcha?: CaptchaAnswer): Promise<LoginResult> {
    const rUrl = DC_HOSTS.mobile;
    const page = await this.send({ method: 'GET', url: `${DC_HOSTS.sign}${DC_PATHS.loginPage}?r_url=${encodeURIComponent(rUrl)}` });
    assertTransportOk(page, { loginFlow: true });
    const conKey = parseHiddenInput(page.text, 'conKey');
    if (!conKey) throw new DcError('structureChanged', '로그인 페이지 구조가 예상과 다릅니다.', { endpoint: 'login', field: 'conKey' });
    // msign 원본 JS는 모든 AJAX에 X-CSRF-TOKEN을 붙인다 ($.ajaxSetup). 지금은 없어도 통과하지만 원본과 맞춘다.
    const signCsrf = parseCsrfToken(page.text);

    // 원본 JS는 code 키를 두 번 보낸다 (아이디, 캡챠 코드). 그대로 재현한다.
    const accessRes = await this.send({
      method: 'POST',
      url: `${DC_HOSTS.sign}${DC_PATHS.loginAccess}`,
      body: formEncode([
        ['token_verify', TOKEN_VERIFY.login],
        ['conKey', conKey],
        ['code', creds.id],
        ['randcode', captcha?.randCode ?? ''],
        ['code', captcha?.code ?? ''],
      ]),
      headers: {
        // 실측(2026-11-26): Accept에 application/json을 넣으면 디시가 빈 본문(200)을 준다.
        // 원본 jQuery 요청과 같은 */*로 보내야 {"result":true,"Block_key":...}가 온다.
        Accept: '*/*',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${DC_HOSTS.sign}${DC_PATHS.loginPage}`,
        ...(signCsrf ? { 'X-CSRF-TOKEN': signCsrf } : {}),
      },
    });
    const access = parseJsonOrThrow(accessRes, 'login/access', { loginFlow: true });
    const a = (access ?? {}) as Record<string, unknown>;
    if (a.result !== 1 && a.result !== true) {
      if (a.reason === 'limit_login' || a.reason === 'wrong_code') {
        return {
          status: 'captcha',
          imageUrl: typeof a.code === 'string' ? a.code : '',
          randCode: typeof a.randCode === 'string' ? a.randCode : (captcha?.randCode ?? ''),
          wrongCode: a.reason === 'wrong_code',
        };
      }
      const why = accessRes.text.trim() === '' ? '빈 응답' : `응답 ${accessRes.status}${typeof a.reason === 'string' ? `, ${a.reason}` : ''}`;
      return { status: 'failed', message: `로그인 사전 확인에 실패했습니다. 잠시 후 다시 시도하세요. (${why})` };
    }
    const blockKey = parseAccessKey(access, 'login/access');

    const submit = await this.send({
      method: 'POST',
      url: `${DC_HOSTS.sign}${DC_PATHS.loginSubmit}`,
      body: formEncode([
        ['code', creds.id],
        ['password', creds.password],
        ['loginCash', 'on'],
        ['conKey', blockKey],
        ['r_url', rUrl],
        ['_token', ''],
      ]),
      // 브라우저의 폼 제출과 같은 Accept. 성공하면 307로 sso.dcinside.com을 거쳐 돌아온다 (POST 유지).
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: `${DC_HOSTS.sign}${DC_PATHS.loginPage}`,
      },
    });
    assertTransportOk(submit, { loginFlow: true });
    if (/otp_num|form_otpjoin/.test(submit.text)) return { status: 'otp' };

    // 실측(2026-11-26): 실패하면 로그인 페이지가 다시 오고 <div class="alert-message">에 사유가 있다.
    const pageMessage = parseLoginFailureMessage(submit.text);
    if (pageMessage) return { status: 'failed', message: pageMessage };

    const uid = await this.restoreSession();
    if (uid) return { status: 'ok', uid };
    const alertMsg = /alert\((["'])(.*?)\1\)/.exec(submit.text)?.[2];
    if (alertMsg) return { status: 'failed', message: alertMsg };
    // 실패 문구 없이 세션도 없으면 디시 응답 형식이 바뀐 것일 수 있다. 진단 정보를 남긴다.
    return {
      status: 'failed',
      message: `로그인 결과를 확인하지 못했습니다. (응답 ${submit.status}, ${maskUrl(submit.url)})`,
    };
  }

  /** 디시 로그아웃. 실패해도 로컬 세션 정보는 지운다. */
  async logout(): Promise<void> {
    try {
      await this.send({ method: 'GET', url: `${DC_HOSTS.sign}${DC_PATHS.logout}?r_url=${encodeURIComponent(DC_HOSTS.mobile)}` });
    } finally {
      this.clearSession();
    }
  }

  // ───────────────────────── 글/댓글 ─────────────────────────

  async listGallog(menu: GallogListMenu, page: number): Promise<GallogPage> {
    const uid = this.requireSession();
    const json = await this.postJson(DC_PATHS.gallogList, [
      ['g_id', uid],
      ['menu', menu],
      ['page', String(page)],
      ['list_more', '1'],
    ]);
    const parsed = parseGallogList(json);
    // 본인 갤로그가 아니면 삭제 권한이 없다. 엉뚱한 계정 데이터로 진행하지 않는다.
    if (!parsed.isOwner) throw new DcError('notOwner', '본인 갤로그가 아닙니다.');
    return parsed;
  }

  /** gall_code → 갤러리 ID (캐시) */
  async resolveGallId(gallCode: string, typeCode: string): Promise<string> {
    const key = `${typeCode}:${gallCode}`;
    const cached = this.gallIdCache.get(key);
    if (cached) return cached;
    this.requireSession();
    const json = await this.postJson(DC_PATHS.listDirect, [
      ['gall_code', gallCode],
      ['gall_type', typeCode],
    ]);
    const id = parseListDirect(json);
    this.gallIdCache.set(key, id);
    return id;
  }

  private async accessKey(tokenVerify: string): Promise<string> {
    return parseAccessKey(await this.postJson(DC_PATHS.ajaxAccess, [['token_verify', tokenVerify]]));
  }

  /**
   * 갤로그에서 글/댓글 삭제 (원본도 함께 삭제됨, dc-protocol §4-A 실측).
   * 반환이 { type: 'ok' }여도 아직 "삭제 확정"이 아니다. 엔진이 목록 재조회로 검증해야 한다.
   * 매니저 차단 경고(del_limit)는 del_limit_chk를 절대 붙이지 않고 skip으로 돌려준다.
   */
  async deleteGallogItem(logNo: string): Promise<ActionVerdict> {
    const uid = this.requireSession();
    const conKey = await this.accessKey(TOKEN_VERIFY.gallogDelete);
    const json = await this.postJson(DC_PATHS.gallogDelete, [
      ['no', logNo],
      ['g_id', uid],
      ['con_key', conKey],
    ]);
    return classifyAction(json);
  }

  /** 원문 페이지 (백업, 추천수/조회수 필터용). 원글이 삭제됐으면 'deleted'. */
  async fetchPost(gallery: GalleryType, gallId: string, postNo: string): Promise<PostFetchResult> {
    const res = await this.send({
      method: 'GET',
      url: `${DC_HOSTS.mobile}${DC_PATHS.view(VIEW_BASE[gallery], gallId, postNo)}`,
    });
    if (isDeletedPostPage(res.status, res.text)) return { status: 'deleted' };
    assertTransportOk(res);
    return { status: 'ok', view: parsePostView(res.text) };
  }

  /**
   * 원글 페이지에 이 댓글이 아직 있는가 (삭제 검증용).
   * 실측(dc-protocol §4-A): 원글 페이지 HTML에 댓글 번호가 그대로 들어 있고, 삭제 후에는 사라졌다.
   * 원글이 삭제됐으면 false.
   */
  async postHasComment(gallery: GalleryType, gallId: string, postNo: string, commentNo: string): Promise<boolean> {
    const res = await this.send({
      method: 'GET',
      url: `${DC_HOSTS.mobile}${DC_PATHS.view(VIEW_BASE[gallery], gallId, postNo)}`,
    });
    if (isDeletedPostPage(res.status, res.text)) return false;
    assertTransportOk(res);
    return new RegExp(`(^|[^0-9])${commentNo}([^0-9]|$)`).test(res.text);
  }

  // ───────────────────────── 방명록 ─────────────────────────

  /** 방명록이 있는 연도 목록 (방명록 페이지의 연도 선택 상자) */
  async listGuestbookYears(): Promise<number[]> {
    const html = await this.loadOwnGallogPage(`?menu=${GALLOG_MENU.guestbook}`);
    return parseGuestbookYears(html);
  }

  async listGuestbook(year: number, page: number): Promise<GuestbookPage> {
    const uid = this.requireSession();
    const json = await this.postJson(DC_PATHS.gallogListGuestbook, [
      ['g_id', uid],
      ['menu', GALLOG_MENU.guestbook],
      ['page', String(page)],
      ['year', String(year)],
      ['list_more', '1'],
    ]);
    const parsed = parseGuestbookList(json);
    if (!parsed.isOwner) throw new DcError('notOwner', '본인 갤로그가 아닙니다.');
    return parsed;
  }

  /**
   * 내 갤로그 방명록 삭제. ⚠️ 실제 응답은 미검증 (dc-protocol §4-D).
   * withReplies: 답글이 달린 글을 지울 때 원본 JS처럼 del_type=comment를 붙인다.
   */
  async deleteGuestbook(no: string, withReplies: boolean): Promise<ActionVerdict> {
    const uid = this.requireSession();
    const conKey = await this.accessKey(TOKEN_VERIFY.guestbookDelete);
    const json = await this.postJson(DC_PATHS.guestbookDelete, [
      ['no', no],
      ['g_id', uid],
      ['con_key', conKey],
      ...(withReplies ? ([['del_type', 'comment']] as const) : []),
    ]);
    return classifyAction(json);
  }
}
