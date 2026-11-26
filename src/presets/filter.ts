/**
 * 프리셋 조건 → 삭제 계획. Dry-run, 수동 실행, 스케줄, 단축어가 모두 이 함수를 쓴다.
 * 순수 함수다: DB, 네트워크, 시계에 의존하지 않는다 (now를 인자로 받음).
 *
 * 안전 규칙
 * - 보호 목록에 있는 항목은 어떤 조건이어도 삭제 대상(targets)에 들어가지 않는다.
 * - 방명록은 선택한 연도 밖의 항목을 절대 넣지 않는다.
 * - 갤러리 ID를 모르는 항목은 갤러리 포함/제외 조건이 있으면 안전하게 제외한다.
 */
import type { GalleryType } from '@/dc/config';
import type { GallogItem, GuestbookItem } from '@/dc/parsers';

import type { DateFilter, KeywordFilter, PresetConfig, YearSelection } from './types';

export type TargetKind = 'post' | 'comment' | 'guestbook';

export type Target = {
  key: string;
  kind: TargetKind;
  title: string;
  writtenAt: string;
  galleryId: string | null;
  gallery: GalleryType | null;
  /** 글: 실행 중 추천수/조회수 검사 필요 */
  needsMetrics: boolean;
  /** 방명록 답글 수 (함께 삭제됨) */
  replyCount: number;
  source: { type: 'gallog'; item: GallogItem } | { type: 'guestbook'; item: GuestbookItem };
};

export type Plan = {
  targets: Target[];
  protectedMatches: Target[];
  counts: Record<TargetKind, number>;
  /** 방명록 연도별 삭제 예정 개수 */
  guestbookByYear: Record<number, number>;
  byGallery: Record<string, number>;
  excluded: number;
};

export function gallogKey(item: Pick<GallogItem, 'kind' | 'gallCode' | 'postNo' | 'commentNo' | 'logNo'>): string {
  return item.kind === 'post' ? `p:${item.gallCode}:${item.postNo}` : `c:${item.gallCode}:${item.commentNo ?? `log${item.logNo}`}`;
}

export function guestbookKey(item: Pick<GuestbookItem, 'no'>): string {
  return `g:${item.no}`;
}

// ───────────────────────── 조건 ─────────────────────────

const norm = (s: string) => s.normalize('NFC').toLowerCase();

export function matchesKeywords(text: string, f: KeywordFilter): boolean {
  const t = norm(text);
  const inc = f.include.map((k) => norm(k.trim())).filter(Boolean);
  const exc = f.exclude.map((k) => norm(k.trim())).filter(Boolean);
  if (inc.length && !inc.some((k) => t.includes(k))) return false;
  return !exc.some((k) => t.includes(k));
}

export function yearSelected(year: number, sel: YearSelection): boolean {
  switch (sel.mode) {
    case 'all':
      return true;
    case 'list':
      return sel.years.includes(year);
    case 'range':
      return year >= Math.min(sel.from, sel.to) && year <= Math.max(sel.from, sel.to);
    case 'upTo':
      return year <= sel.year;
  }
}

/** writtenAt('YYYY-MM-DDTHH:MM:SS', 한국 시각)이 날짜 조건을 만족하는가 */
export function dateMatches(writtenAt: string, date: DateFilter, now: Date): boolean {
  switch (date.mode) {
    case 'any':
      return true;
    case 'olderThanDays': {
      const written = Date.parse(`${writtenAt}+09:00`);
      if (!Number.isFinite(written)) return false;
      return now.getTime() - written >= date.days * 86_400_000;
    }
    case 'before':
      return writtenAt.slice(0, 10) < date.date;
  }
}

// ───────────────────────── 계획 ─────────────────────────

export type PlanInput = {
  config: PresetConfig;
  gallogItems: GallogItem[];
  guestbookItems: GuestbookItem[];
  /** `${typeCode}:${gallCode}` → gallId */
  galleryIds: Map<string, string>;
  protectedKeys: Set<string>;
  now: Date;
};

export function buildPlan(input: PlanInput): Plan {
  const { config, protectedKeys, now } = input;
  const targets: Target[] = [];
  const protectedMatches: Target[] = [];
  let excluded = 0;
  const push = (t: Target) => (protectedKeys.has(t.key) ? protectedMatches : targets).push(t);

  for (const item of input.gallogItems) {
    const kindOn = item.kind === 'post' ? config.kinds.post : config.kinds.comment;
    const galleryId = input.galleryIds.get(`${item.typeCode}:${item.gallCode}`) ?? null;
    if (!kindOn || !gallogMatches(item, galleryId, config, now)) {
      excluded++;
      continue;
    }
    push({
      key: gallogKey(item),
      kind: item.kind,
      title: item.kind === 'post' ? item.subject : item.memoText || item.subject,
      writtenAt: item.writtenAt,
      galleryId,
      gallery: item.gallery,
      needsMetrics: item.kind === 'post' && (config.metrics.maxRecommends !== null || config.metrics.maxViews !== null),
      replyCount: 0,
      source: { type: 'gallog', item },
    });
  }

  const guestbookOn = config.kinds.guestbook && config.guestbook.onMyGallog;
  for (const item of input.guestbookItems) {
    if (!guestbookOn || !guestbookMatches(item, config)) {
      excluded++;
      continue;
    }
    push({
      key: guestbookKey(item),
      kind: 'guestbook',
      title: item.memoText,
      writtenAt: item.writtenAt,
      galleryId: null,
      gallery: null,
      needsMetrics: false,
      replyCount: item.replies.length,
      source: { type: 'guestbook', item },
    });
  }

  // 오래된 것부터 지운다 (중단돼도 오래된 글이 먼저 정리되도록)
  targets.sort((a, b) => (a.writtenAt < b.writtenAt ? -1 : a.writtenAt > b.writtenAt ? 1 : 0));

  const counts: Record<TargetKind, number> = { post: 0, comment: 0, guestbook: 0 };
  const guestbookByYear: Record<number, number> = {};
  const byGallery: Record<string, number> = {};
  for (const t of targets) {
    counts[t.kind]++;
    if (t.kind === 'guestbook') {
      const y = Number(t.writtenAt.slice(0, 4));
      guestbookByYear[y] = (guestbookByYear[y] ?? 0) + 1;
    } else {
      const g = t.galleryId ?? '(알 수 없음)';
      byGallery[g] = (byGallery[g] ?? 0) + 1;
    }
  }
  return { targets, protectedMatches, counts, guestbookByYear, byGallery, excluded };
}

function gallogMatches(item: GallogItem, galleryId: string | null, c: PresetConfig, now: Date): boolean {
  if (item.gallery === 'person') return false; // 인물 갤러리는 지원 범위 밖 (미검증)
  if (!c.galleryTypes[item.gallery]) return false;
  if (c.galleryScope.mode !== 'all') {
    if (galleryId === null) return false;
    const listed = c.galleryScope.galleryIds.includes(galleryId);
    if (c.galleryScope.mode === 'include' && !listed) return false;
    if (c.galleryScope.mode === 'exclude' && listed) return false;
  }
  if (!dateMatches(item.writtenAt, c.date, now)) return false;
  const text =
    c.keywords.target === 'title' ? item.subject : c.keywords.target === 'content' ? item.memoText : `${item.subject}\n${item.memoText}`;
  return matchesKeywords(text, c.keywords);
}

function guestbookMatches(item: GuestbookItem, c: PresetConfig): boolean {
  if (!item.canDelete) return false;
  if (!yearSelected(item.year, c.guestbook.years)) return false;
  if (c.guestbook.months.length && !c.guestbook.months.includes(Number(item.writtenAt.slice(5, 7)))) return false;
  if (!matchesKeywords(`${item.authorName} ${item.authorId}`, c.guestbook.authors)) return false;
  return matchesKeywords(item.memoText, c.guestbook.keywords);
}

/** 추천수/조회수 조건 (원문을 읽은 뒤 실행 중에 검사). 값을 모르면 안전하게 지우지 않는다. */
export function metricsAllowDelete(m: PresetConfig['metrics'], views: number | null, recommends: number | null): boolean {
  if (m.maxRecommends !== null && (recommends === null || recommends > m.maxRecommends)) return false;
  if (m.maxViews !== null && (views === null || views > m.maxViews)) return false;
  return true;
}

/** 프리셋 요약 문구 (목록 화면용) */
export function describePreset(c: PresetConfig): string {
  const kinds = [c.kinds.post && '글', c.kinds.comment && '댓글', c.kinds.guestbook && '방명록'].filter(Boolean).join('·') || '대상 없음';
  const date = c.date.mode === 'any' ? '전체 기간' : c.date.mode === 'olderThanDays' ? `${c.date.days}일 지난 것` : `${c.date.date} 이전`;
  const scope =
    c.galleryScope.mode === 'all'
      ? '전체 갤러리'
      : `갤러리 ${c.galleryScope.galleryIds.length}곳 ${c.galleryScope.mode === 'include' ? '만' : '제외'}`;
  return `${kinds} · ${scope} · ${date}`;
}
