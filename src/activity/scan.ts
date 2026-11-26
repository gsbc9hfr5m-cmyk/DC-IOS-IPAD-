/**
 * 내 글/댓글 전체 불러오기 (메인 화면).
 * - 갤로그 G_all(글) → R_all(댓글)을 1페이지부터 끝까지 읽는다.
 * - 페이지를 읽을 때마다 바로 저장하므로 화면의 갤러리 목록이 실시간으로 늘어난다.
 * - 끝까지 읽으면 이번에 보이지 않은 항목(이미 지워진 것)을 캐시에서 뺀다.
 * - 요청 한도(429)는 안내된 시간만큼 기다렸다 이어 읽는다 (최대 3회).
 */
import { GALLOG_MENU } from '@/dc/config';
import type { DcClient } from '@/dc/DcClient';
import { DcError, isDcError } from '@/dc/errors';
import type { GallogItem } from '@/dc/parsers';
import { gallogKey } from '@/presets/filter';

export type ScanKind = 'post' | 'comment';

export type ScanProgress = {
  kind: ScanKind;
  page: number;
  lastPage: number;
  /** 갤로그가 알려 준 전체 개수 */
  total: number;
  read: number;
  waitingMs?: number;
};

export type ScanSink = {
  upsertGallogItems: (kind: ScanKind, items: { key: string; item: GallogItem }[]) => void;
  removeItemsNotIn: (kind: ScanKind, keep: Set<string>) => number;
};

export type ScanOptions = {
  client: Pick<DcClient, 'listGallog'>;
  sink: ScanSink;
  onProgress?: (p: ScanProgress) => void;
  signal?: { aborted: boolean };
  sleep?: (ms: number) => Promise<void>;
};

export class ScanCancelled extends Error {
  constructor() {
    super('불러오기를 멈췄습니다.');
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function scanKind(kind: ScanKind, o: ScanOptions): Promise<number> {
  const menu = kind === 'post' ? GALLOG_MENU.postsAll : GALLOG_MENU.commentsAll;
  const seen = new Set<string>();
  let page = 1;
  let lastPage = 1;
  let total = 0;
  do {
    const progress: ScanProgress = { kind, page, lastPage, total, read: seen.size };
    o.onProgress?.(progress);
    const res = await withRetry(() => o.client.listGallog(menu, page), o, progress);
    lastPage = Math.max(1, res.lastPage);
    total = res.total;
    const batch: { key: string; item: GallogItem }[] = [];
    for (const item of res.items) {
      if (item.kind !== kind) throw new DcError('structureChanged', '목록에 예상과 다른 종류가 섞여 있습니다.', { menu, got: item.typeCode });
      const key = gallogKey(item);
      seen.add(key);
      batch.push({ key, item });
    }
    o.sink.upsertGallogItems(kind, batch);
    o.onProgress?.({ kind, page, lastPage, total, read: seen.size });
    page++;
  } while (page <= lastPage);
  o.sink.removeItemsNotIn(kind, seen);
  return seen.size;
}

async function withRetry<T>(fn: () => Promise<T>, o: ScanOptions, progress: ScanProgress): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    if (o.signal?.aborted) throw new ScanCancelled();
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
