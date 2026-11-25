/**
 * 디시 응답 파서와 구조 검증 (spec 2-7: "응답 파싱이 예상 구조와 다르면 삭제를 중단").
 * ⚠️ 필드 이름은 docs/dc-protocol.md §3-3, §4-D 실측 기준. 하나라도 어긋나면 structureChanged를 던진다.
 */
import { HTML_PATTERNS, ITEM_TYPE_MAP, type GalleryType, type ItemKind } from './config';
import { DcError } from './errors';

// ───────────────────────── 타입 ─────────────────────────

export type GallogItem = {
  kind: ItemKind;
  gallery: GalleryType;
  /** 원본 type 코드 (G/E/N/R/D/I) */
  typeCode: string;
  /** 갤로그 로그 번호: 삭제(log-del)에 쓴다 */
  logNo: string;
  gallCode: string;
  /** 원글 번호 (댓글이면 그 댓글이 달린 글) */
  postNo: string;
  /** 댓글 번호 (글이면 null) */
  commentNo: string | null;
  subject: string;
  /** 댓글 원문 HTML (멘션, 디시콘 포함) */
  memoHtml: string;
  memoText: string;
  /** 'YYYY-MM-DDTHH:MM:SS' (KST 기준 로컬 시각) */
  writtenAt: string;
  isReply: boolean;
};

export type Page<T> = { items: T[]; page: number; lastPage: number; perPage: number; total: number };

export type GallogPage = Page<GallogItem> & { isOwner: boolean };

export type GuestbookItem = {
  no: string;
  headnum: string;
  authorId: string;
  authorName: string;
  isMember: boolean;
  memoText: string;
  writtenAt: string;
  year: number;
  secret: boolean;
  /** 내가 지울 수 있는가 (del_scope 또는 갤로그 주인) */
  canDelete: boolean;
  replies: GuestbookItem[];
};

export type GuestbookPage = Page<GuestbookItem> & { isOwner: boolean };

// ───────────────────────── 검증 도우미 ─────────────────────────

type Json = Record<string, unknown>;

function fail(endpoint: string, path: string, got: unknown): never {
  throw new DcError('structureChanged', '디시 응답 구조가 예상과 다릅니다.', {
    endpoint,
    path,
    got: got === null ? 'null' : Array.isArray(got) ? 'array' : typeof got,
  });
}

function obj(v: unknown, ep: string, path: string): Json {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(ep, path, v);
  return v as Json;
}

function arr(v: unknown, ep: string, path: string): unknown[] {
  if (!Array.isArray(v)) fail(ep, path, v);
  return v;
}

/** 숫자 필드는 number 또는 숫자 문자열로 온다 (실측: total이 메뉴에 따라 다름) */
function num(v: unknown, ep: string, path: string): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) fail(ep, path, v);
  return n;
}

function str(v: unknown, ep: string, path: string): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return fail(ep, path, v);
}

function optStr(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

// ───────────────────────── 날짜, 텍스트 ─────────────────────────

/** "YYYY.MM.DD" / "YYYY-MM-DD" + 선택적 "HH:MM:SS" → 'YYYY-MM-DDTHH:MM:SS' */
export function parseDcDate(date: string, time = '00:00:00'): string | null {
  const d = /^(\d{4})[.-](\d{2})[.-](\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(date.trim());
  const t = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!d) return null;
  const hh = d[4] ?? t?.[1] ?? '00';
  const mm = d[5] ?? t?.[2] ?? '00';
  const ss = d[6] ?? t?.[3] ?? '00';
  return `${d[1]}-${d[2]}-${d[3]}T${hh}:${mm}:${ss}`;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };

/** 댓글/방명록 HTML → 표시용 텍스트. 디시콘은 [디시콘]으로 치환한다. */
export function htmlToText(html: string): string {
  return html
    .replace(/<img[^>]*class=["'][^"']*written_dccon[^"']*["'][^>]*>/gi, '[디시콘]')
    .replace(/<img[^>]*>/gi, '[이미지]')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+|#39);/gi, (m, e: string) => {
      const k = e.toLowerCase();
      if (k in ENTITIES) return ENTITIES[k]!;
      if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
      if (k.startsWith('#')) return String.fromCodePoint(parseInt(k.slice(1), 10));
      return m;
    })
    .trim();
}

// ───────────────────────── 갤로그 글/댓글 목록 ─────────────────────────

function parsePageMeta(list: Json, ep: string) {
  return {
    page: num(list.current_page, ep, 'gallog_list.current_page'),
    lastPage: num(list.last_page, ep, 'gallog_list.last_page'),
    perPage: num(list.per_page, ep, 'gallog_list.per_page'),
    total: num(list.total, ep, 'gallog_list.total'),
  };
}

function parseOwner(info: Json, ep: string): boolean {
  const v = info.managerskill;
  if (typeof v !== 'boolean') fail(ep, 'gallog_info.managerskill', v);
  return v;
}

export function parseGallogList(json: unknown): GallogPage {
  const ep = 'response-galloglist';
  const root = obj(json, ep, '$');
  const info = obj(root.gallog_info, ep, 'gallog_info');
  const list = obj(root.gallog_list, ep, 'gallog_list');
  const data = arr(list.data, ep, 'gallog_list.data');

  const items = data.map((raw, i): GallogItem => {
    const p = `gallog_list.data[${i}]`;
    const d = obj(raw, ep, p);
    const typeCode = str(d.type, ep, `${p}.type`);
    const mapped = ITEM_TYPE_MAP[typeCode];
    // 모르는 종류가 나오면 디시가 구조를 바꾼 것이다. 추측해서 지우지 않는다.
    if (!mapped) fail(ep, `${p}.type(${typeCode})`, typeCode);
    const writtenAt = parseDcDate(str(d.wdate, ep, `${p}.wdate`), optStr(d.wtime) || '00:00:00');
    if (!writtenAt) fail(ep, `${p}.wdate`, d.wdate);
    const cno = optStr(d.cno);
    const memoHtml = optStr(d.memo);
    return {
      kind: mapped.kind,
      gallery: mapped.gallery,
      typeCode,
      logNo: str(d.no, ep, `${p}.no`),
      gallCode: str(d.gall_code, ep, `${p}.gall_code`),
      postNo: str(d.pno, ep, `${p}.pno`),
      commentNo: mapped.kind === 'comment' && cno !== '' && cno !== '0' ? cno : null,
      subject: htmlToText(optStr(d.subject)),
      memoHtml,
      memoText: htmlToText(memoHtml),
      writtenAt,
      isReply: d.re_comment === true,
    };
  });

  return { ...parsePageMeta(list, ep), items, isOwner: parseOwner(info, ep) };
}

// ───────────────────────── 방명록 ─────────────────────────

function parseGuestbookItem(raw: unknown, ep: string, p: string, isOwner: boolean): GuestbookItem {
  const d = obj(raw, ep, p);
  const writtenAt = parseDcDate(str(d.write_time, ep, `${p}.write_time`));
  if (!writtenAt) fail(ep, `${p}.write_time`, d.write_time);
  const replies = d.reple === undefined || d.reple === null ? [] : arr(d.reple, ep, `${p}.reple`);
  return {
    no: str(d.no, ep, `${p}.no`),
    headnum: optStr(d.headnum),
    authorId: optStr(d.user_id),
    authorName: optStr(d.name),
    isMember: optStr(d.ismember) !== '0' && optStr(d.ismember) !== '',
    memoText: htmlToText(optStr(d.memo)),
    writtenAt,
    year: Number(writtenAt.slice(0, 4)),
    secret: optStr(d.category) === '0',
    canDelete: d.del_scope === true || isOwner,
    replies: replies.map((r, j) => parseGuestbookItem(r, ep, `${p}.reple[${j}]`, isOwner)),
  };
}

export function parseGuestbookList(json: unknown): GuestbookPage {
  const ep = 'response-galloglistGb';
  const root = obj(json, ep, '$');
  const info = obj(root.gallog_info, ep, 'gallog_info');
  const list = obj(root.gallog_list, ep, 'gallog_list');
  const isOwner = parseOwner(info, ep);
  const data = arr(list.data, ep, 'gallog_list.data');
  return {
    ...parsePageMeta(list, ep),
    isOwner,
    items: data.map((r, i) => parseGuestbookItem(r, ep, `gallog_list.data[${i}]`, isOwner)),
  };
}

// ───────────────────────── 기타 JSON ─────────────────────────

/** /ajax/access → Block_key */
export function parseAccessKey(json: unknown, endpoint = 'ajax/access'): string {
  const j = obj(json, endpoint, '$');
  const key = j.Block_key;
  if (typeof key !== 'string' || key.length < 8) fail(endpoint, 'Block_key', key);
  return key;
}

/** /gallog/list-direct → gall_id */
export function parseListDirect(json: unknown): string {
  const j = obj(json, 'list-direct', '$');
  const id = j.gall_id;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_]+$/.test(id)) fail('list-direct', 'gall_id', id);
  return id;
}

// ───────────────────────── HTML ─────────────────────────

export function parseCsrfToken(html: string): string | null {
  return HTML_PATTERNS.csrfMeta.exec(html)?.[1] ?? null;
}

/** name 또는 id가 일치하는 첫 input의 value (속성 순서와 무관) */
export function parseHiddenInput(html: string, name: string): string | null {
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    const attr = (a: string) => new RegExp(`\\b${a}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag)?.[2];
    if (attr('name') === name || attr('id') === name) return attr('value') ?? '';
  }
  return null;
}

/** 로그인 상태의 모바일 페이지에서 내 갤로그 ID를 찾는다. 로그아웃 링크가 없으면 비로그인으로 본다. */
export function parseLoggedInUid(html: string): string | null {
  if (!HTML_PATTERNS.logoutLink.test(html)) return null;
  return HTML_PATTERNS.myGallogLink.exec(html)?.[1] ?? null;
}

/** 방명록 페이지의 연도 선택 상자 → 연도 목록 (내림차순) */
export function parseGuestbookYears(html: string): number[] {
  const select = HTML_PATTERNS.guestbookYearSelect.exec(html)?.[1];
  if (!select) return [];
  const years = [...select.matchAll(HTML_PATTERNS.guestbookYearOption)].map((m) => Number(m[1]));
  return [...new Set(years)].sort((a, b) => b - a);
}

export function isDeletedPostPage(status: number, html: string): boolean {
  return status === 403 && HTML_PATTERNS.deletedPost.test(html);
}

/** `<div class="...cls...">`의 안쪽 HTML을 중첩된 div를 고려해 꺼낸다. 없으면 null. */
export function extractDivInner(html: string, cls: string): string | null {
  const open = new RegExp(`<div[^>]*class=["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>`, 'i').exec(html);
  if (!open) return null;
  const start = open.index + open[0].length;
  const tag = /<(\/?)div\b[^>]*>/gi;
  tag.lastIndex = start;
  let depth = 1;
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index);
  }
  return null;
}

export type PostView = {
  title: string;
  bodyHtml: string;
  bodyText: string;
  /** 'YYYY-MM-DDTHH:MM:SS' 또는 null */
  writtenAt: string | null;
  views: number | null;
  recommends: number | null;
};

/**
 * 모바일 게시글 페이지 파싱 (백업, 추천수/조회수 필터용).
 * ⚠️ 2026-11-26 관찰: 제목 .gallview-tit-box .tit, 작성일 .gallview-tit-box .ginfo2 li,
 *    본문 .thum-txtin, 조회수 "조회수 N", 추천 .up-add span
 */
export function parsePostView(html: string): PostView {
  const head = extractDivInner(html, 'gallview-tit-box');
  const bodyHtml = extractDivInner(html, 'thum-txtin');
  if (head === null || bodyHtml === null) {
    throw new DcError('structureChanged', '게시글 페이지 구조가 예상과 다릅니다.', {
      endpoint: 'view',
      hasTitleBox: head !== null,
      hasBody: bodyHtml !== null,
    });
  }
  const title = htmlToText(/<span[^>]*class=["']tit["'][^>]*>([\s\S]*?)<\/span>/i.exec(head)?.[1] ?? '').replace(/\s+/g, ' ');
  const dateRaw = /(\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}(?::\d{2})?)/.exec(head)?.[1];
  const views = /조회수\s*([\d,]+)/.exec(html)?.[1];
  const recommends = /class=["']up-add["'][^>]*>\s*추천\s*<span[^>]*>([\d,]+)/.exec(html)?.[1];
  const toNum = (s?: string) => (s ? Number(s.replace(/,/g, '')) : null);
  return {
    title,
    bodyHtml: bodyHtml.trim(),
    bodyText: htmlToText(bodyHtml),
    writtenAt: dateRaw ? parseDcDate(dateRaw) : null,
    views: toNum(views),
    recommends: toNum(recommends),
  };
}
