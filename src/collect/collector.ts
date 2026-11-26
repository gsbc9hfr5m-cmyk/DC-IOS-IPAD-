/**
 * 내 글/댓글/방명록 목록 수집 (spec 2-6 "내 글/댓글 목록 수집 후 삭제 큐를 만든다").
 * 수집 방법: 모바일 갤로그 API (dc-protocol §3, §4-D 실측).
 * - 요청 한도는 DcClient의 RateLimiter가 지킨다 (1분에 약 20회 공유).
 * - 429면 안내된 시간만큼 기다렸다가 이어서 수집한다 (최대 3회). 그 밖의 중단 오류는 그대로 던진다.
 * - 수집이 끝까지 성공했을 때만 캐시를 교체한다 (도중에 멈추면 이전 캐시 유지).
 */
import { GALLOG_MENU } from '@/dc/config';
import type { DcClient } from '@/dc/DcClient';
import { DcError, isDcError } from '@/dc/errors';
import type { GallogItem, GuestbookItem } from '@/dc/parsers';
import { gallogKey, guestbookKey } from '@/presets/filter';

export type CollectKind = 'post' | 'comment' | 'guestbook';

export type CollectProgress = {
  kind: CollectKind;
  /** 방명록이면 현재 연도 */
  year?: number;
  page: number;
  lastPage: number;
  collected: number;
  /** 요청 한도로 대기 중이면 남은 ms */
  waitingMs?: number;
};

export type CollectSink = {
  replaceGallogItems: (kind: 'post' | 'comment', items: { key: string; item: GallogItem }[]) => void;
  replaceGuestbookItems: (items: { key: string; item: GuestbookItem }[]) => void;
  galleryIdMap: () => Map<string, string>;
  saveGalleryId: (gallCode: string, typeCode: string, gallId: string) => void;
  /** 부분 수집(collectRecent)용 */
  knownKeys?: (kind: 'post' | 'comment') => Set<string>;
  upsertGallogItems?: (kind: 'post' | 'comment', items: { key: string; item: GallogItem }[]) => void;
};

export type CollectOptions = {
  client: Pick<DcClient, 'listGallog' | 'resolveGallId' | 'listGuestbookYears' | 'listGuestbook'>;
  sink: CollectSink;
  onProgress?: (p: CollectProgress) => void;
  signal?: { aborted: boolean };
  sleep?: (ms: number) => Promise<void>;
};

export class CollectCancelled extends Error {
  constructor() {
    super('수집을 취소했습니다.');
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function withRateLimitRetry<T>(fn: () => Promise<T>, o: CollectOptions, progress: CollectProgress): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    if (o.signal?.aborted) throw new CollectCancelled();
    try {
      return await fn();
    } catch (e) {
      if (isDcError(e) && e.code === 'rateLimited' && attempt < 3) {
        const wait = e.retryAfterMs ?? 75_000;
        o.onProgress?.({ ...progress, waitingMs: wait });
        await (o.sleep ?? defaultSleep)(wait);
        continue;
      }
      throw e;
    }
  }
}

export async function collectGallog(kind: 'post' | 'comment', o: CollectOptions): Promise<number> {
  const menu = kind === 'post' ? GALLOG_MENU.postsAll : GALLOG_MENU.commentsAll;
  const all = new Map<string, GallogItem>();
  let page = 1;
  let lastPage = 1;
  do {
    const progress: CollectProgress = { kind, page, lastPage, collected: all.size };
    const res = await withRateLimitRetry(() => o.client.listGallog(menu, page), o, progress);
    lastPage = res.lastPage;
    for (const item of res.items) {
      // G_all/R_all에 다른 종류가 섞여 오면 구조 변경으로 본다
      if (item.kind !== kind) {
        throw new DcError('structureChanged', '목록에 예상과 다른 종류가 섞여 있습니다.', { menu, got: item.typeCode });
      }
      all.set(gallogKey(item), item);
    }
    o.onProgress?.({ kind, page, lastPage, collected: all.size });
    page++;
  } while (page <= lastPage);

  await resolveGalleries([...all.values()], o);
  o.sink.replaceGallogItems(
    kind,
    [...all.entries()].map(([key, item]) => ({ key, item })),
  );
  return all.size;
}

/** 아직 모르는 gall_code만 list-direct로 조회해 캐시한다 */
async function resolveGalleries(items: GallogItem[], o: CollectOptions): Promise<void> {
  const known = o.sink.galleryIdMap();
  const pending = new Map<string, GallogItem>();
  for (const i of items) {
    const k = `${i.typeCode}:${i.gallCode}`;
    if (!known.has(k) && !pending.has(k)) pending.set(k, i);
  }
  let n = 0;
  for (const i of pending.values()) {
    const progress: CollectProgress = { kind: i.kind, page: ++n, lastPage: pending.size, collected: items.length };
    o.onProgress?.(progress);
    const id = await withRateLimitRetry(() => o.client.resolveGallId(i.gallCode, i.typeCode), o, progress);
    o.sink.saveGalleryId(i.gallCode, i.typeCode, id);
  }
}

export async function collectGuestbook(o: CollectOptions): Promise<number> {
  const years = await withRateLimitRetry(() => o.client.listGuestbookYears(), o, { kind: 'guestbook', page: 0, lastPage: 0, collected: 0 });
  const all = new Map<string, GuestbookItem>();
  for (const year of years) {
    let page = 1;
    let lastPage = 1;
    do {
      const progress: CollectProgress = { kind: 'guestbook', year, page, lastPage, collected: all.size };
      const res = await withRateLimitRetry(() => o.client.listGuestbook(year, page), o, progress);
      lastPage = res.lastPage;
      for (const item of res.items) {
        // 연도 조회 결과에 다른 연도가 섞이면 연도 필터를 믿을 수 없으므로 멈춘다
        if (item.year !== year) {
          throw new DcError('structureChanged', '방명록 연도 조회 결과에 다른 연도가 섞여 있습니다.', { year, got: item.year });
        }
        all.set(guestbookKey(item), item);
      }
      o.onProgress?.({ kind: 'guestbook', year, page, lastPage, collected: all.size });
      page++;
    } while (page <= lastPage);
  }
  o.sink.replaceGuestbookItems([...all.entries()].map(([key, item]) => ({ key, item })));
  return all.size;
}

/**
 * 최근 글만 빠르게 다시 수집해 캐시에 합친다 (스케줄/단축어 실행용).
 * 1페이지부터 읽다가, 페이지의 모든 항목이 이미 캐시에 있으면 멈춘다 (최대 maxPages).
 */
export async function collectRecent(kind: 'post' | 'comment', o: CollectOptions & { maxPages?: number }): Promise<number> {
  if (!o.sink.knownKeys || !o.sink.upsertGallogItems) throw new Error('sink가 부분 수집을 지원하지 않습니다.');
  const menu = kind === 'post' ? GALLOG_MENU.postsAll : GALLOG_MENU.commentsAll;
  const known = o.sink.knownKeys(kind);
  const fresh: { key: string; item: GallogItem }[] = [];
  const maxPages = o.maxPages ?? 3;
  for (let page = 1; page <= maxPages; page++) {
    const progress: CollectProgress = { kind, page, lastPage: maxPages, collected: fresh.length };
    const res = await withRateLimitRetry(() => o.client.listGallog(menu, page), o, progress);
    let newOnPage = 0;
    for (const item of res.items) {
      if (item.kind !== kind) throw new DcError('structureChanged', '목록에 예상과 다른 종류가 섞여 있습니다.', { menu, got: item.typeCode });
      const key = gallogKey(item);
      if (!known.has(key)) {
        newOnPage++;
        fresh.push({ key, item });
      }
    }
    if (newOnPage === 0 || page >= res.lastPage) break;
  }
  await resolveGalleries(
    fresh.map((f) => f.item),
    o,
  );
  o.sink.upsertGallogItems(kind, fresh);
  return fresh.length;
}

/** 대략적인 수집 소요 시간 (요청 간격 평균 5.5초 기준) */
export function estimateCollectMs(pages: number): number {
  return pages * 5_500;
}
