/**
 * ⚠️ 디시 측 변경에 취약한 값은 전부 이 파일에 모은다.
 * 근거는 docs/dc-protocol.md (조사일 2026-11-26). 디시가 바꾸면 여기만 고친다.
 */

export const DC_HOSTS = {
  mobile: 'https://m.dcinside.com',
  sign: 'https://msign.dcinside.com',
} as const;

/**
 * 모바일 UA가 필수다. 데스크톱 UA로 요청하면 PC판(gall/gallog.dcinside.com)으로 리다이렉트되고
 * csrf meta가 없는 페이지가 온다 (dc-protocol §1, §3-3).
 */
export const MOBILE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';

export const DC_PATHS = {
  loginPage: '/login', // sign
  loginAccess: '/login/access', // sign
  loginSubmit: '/login', // sign
  logout: '/logout', // sign
  ajaxAccess: '/ajax/access', // mobile
  gallogPage: (uid: string) => `/gallog/${encodeURIComponent(uid)}`,
  gallogList: '/ajax/response-galloglist',
  gallogListGuestbook: '/ajax/response-galloglistGb',
  gallogDelete: '/gallog/log-del',
  guestbookDelete: '/gallog/guestbook_del',
  listDirect: '/gallog/list-direct',
  view: (base: 'board' | 'mini' | 'person', gallId: string, no: string) =>
    `/${base}/${encodeURIComponent(gallId)}/${encodeURIComponent(no)}`,
} as const;

/** /ajax/access 의 token_verify 값 (dc-protocol §1) */
export const TOKEN_VERIFY = {
  login: 'dc_login',
  gallogDelete: 'gallogDel',
  guestbookDelete: 'guestbookDel',
} as const;

/** 갤로그 메뉴 코드 (dc-protocol §3-3, 실측) */
export const GALLOG_MENU = {
  postsAll: 'G_all',
  commentsAll: 'R_all',
  guestbook: 'U',
} as const;

export type GalleryType = 'general' | 'minor' | 'mini' | 'person';
export type ItemKind = 'post' | 'comment';

/** 항목 type 코드 → 종류 (실측: G/E/N 글, R/D/I 댓글). person(Q/P)은 스크랩 코드에서 추정 */
export const ITEM_TYPE_MAP: Record<string, { kind: ItemKind; gallery: GalleryType }> = {
  G: { kind: 'post', gallery: 'general' },
  E: { kind: 'post', gallery: 'minor' },
  N: { kind: 'post', gallery: 'mini' },
  R: { kind: 'comment', gallery: 'general' },
  D: { kind: 'comment', gallery: 'minor' },
  I: { kind: 'comment', gallery: 'mini' },
};

export const VIEW_BASE: Record<GalleryType, 'board' | 'mini' | 'person'> = {
  general: 'board',
  minor: 'board', // 모바일은 마이너도 /board (is_minor=1)
  mini: 'mini',
  person: 'person',
};

/** 요청 한도 (dc-protocol §6-1 실측: x-ratelimit-limit 20, 창 ≈ 60초 추정) */
export const RATE_LIMIT = {
  windowMs: 60_000,
  limit: 20,
  /** 이 값 이하로 남으면 다음 창까지 대기 */
  reserve: 5,
  /** 기본 요청 간격 (지터 포함 4~7초) */
  minIntervalMs: 4_000,
  jitterMs: 3_000,
  /** 429를 받으면 최소 대기 */
  cooldownMs: 75_000,
} as const;

/** HTML에서 값을 뽑는 정규식. 구조가 바뀌면 여기부터 확인한다. */
export const HTML_PATTERNS = {
  csrfMeta: /<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i,
  /** 로그인 후 GNB의 내 갤로그 링크 */
  myGallogLink: /href=["'](?:https:\/\/m\.dcinside\.com)?\/gallog\/([A-Za-z0-9_-]+)["']/,
  logoutLink: /msign\.dcinside\.com\/logout/,
  guestbookYearOption: /<option\s+value=["'](\d{4})["']/g,
  guestbookYearSelect: /<select[^>]*guestBook_change[^>]*>([\s\S]*?)<\/select>/i,
  deletedPost: /게시물 작성자가 삭제했거나 존재하지 않는 페이지입니다/,
};
