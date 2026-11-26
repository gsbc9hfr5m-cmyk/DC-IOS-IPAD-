/**
 * 메인 화면 상태: 내 글/댓글 불러오기와 갤러리 선택 삭제.
 */
import { create } from 'zustand';

import * as repos from '@/db/repos';
import { isDcError } from '@/dc/errors';
import { createRun, runNow } from '@/engine/runController';
import type { RunTarget } from '@/engine/types';
import { dc, ensureSession } from '@/services/session';

import { buildTargets, runName, type DeleteKinds } from './targets';
import { ScanCancelled, scanKind, type ScanProgress } from './scan';

type State = {
  scanning: boolean;
  progress: ScanProgress | null;
  error: string | null;
  /** 페이지를 읽을 때마다 증가 → 화면이 갤러리 목록을 다시 읽는다 */
  version: number;
};

export const useActivity = create<State>()(() => ({ scanning: false, progress: null, error: null, version: 0 }));

const SCANNED_AT = 'activity.scannedAt';

export function scannedAt(): string | null {
  return repos.getMeta(SCANNED_AT);
}

let abort: { aborted: boolean } | null = null;

/** 글 전체 → 댓글 전체를 다시 불러온다 */
export async function startScan(): Promise<boolean> {
  if (useActivity.getState().scanning) return false;
  abort = { aborted: false };
  const signal = abort;
  useActivity.setState({ scanning: true, error: null, progress: null });
  try {
    await ensureSession();
    const opts = {
      client: dc,
      sink: repos,
      signal,
      onProgress: (p: ScanProgress) => useActivity.setState((s) => ({ progress: p, version: s.version + 1 })),
    };
    await scanKind('post', opts);
    await scanKind('comment', opts);
    repos.setMeta(SCANNED_AT, new Date().toISOString());
    return true;
  } catch (e) {
    const msg = e instanceof ScanCancelled ? e.message : isDcError(e) ? e.message : '목록을 불러오는 중 오류가 발생했습니다.';
    useActivity.setState({ error: msg });
    return false;
  } finally {
    abort = null;
    useActivity.setState((s) => ({ scanning: false, progress: null, version: s.version + 1 }));
  }
}

export function stopScan(): void {
  if (abort) abort.aborted = true;
}

/** 선택한 갤러리들의 삭제 대상 */
export function collectTargets(groupIds: string[], kinds: DeleteKinds): RunTarget[] {
  const ids = repos.galleryIdMap();
  return buildTargets(
    groupIds.flatMap((g) => repos.galleryItems(g)),
    kinds,
    ids,
    repos.isProtected,
  );
}

/**
 * 갤러리 ID(백업 원문 링크, 삭제 확인용)를 아직 모르면 조회해 저장한다.
 * 갤러리마다 한 번이고 결과는 기기에 남는다.
 */
async function resolveGalleryIds(groupIds: string[], kinds: DeleteKinds): Promise<void> {
  const known = repos.galleryIdMap();
  const pending = new Map<string, { gallCode: string; typeCode: string }>();
  for (const g of groupIds) {
    for (const { item } of repos.galleryItems(g)) {
      if (!kinds.includes(item.kind)) continue;
      const k = `${item.typeCode}:${item.gallCode}`;
      if (!known.has(k) && !pending.has(k)) pending.set(k, { gallCode: item.gallCode, typeCode: item.typeCode });
    }
  }
  for (const p of pending.values()) {
    try {
      repos.saveGalleryId(p.gallCode, p.typeCode, await dc.resolveGallId(p.gallCode, p.typeCode));
    } catch (e) {
      // 갤러리 ID를 몰라도 삭제는 된다 (백업은 링크 없이 남는다). 세션 문제만 위로 올린다.
      if (isDcError(e) && (e.code === 'sessionExpired' || e.code === 'blocked')) throw e;
    }
  }
}

/** 선택한 갤러리 삭제 시작. 확인 대화상자는 화면에서 받는다. 실행 ID를 돌려준다. */
export async function startDelete(groupIds: string[], kinds: DeleteKinds): Promise<string | null> {
  await ensureSession();
  await resolveGalleryIds(groupIds, kinds);
  const targets = collectTargets(groupIds, kinds);
  const names = repos
    .galleryGroups()
    .filter((g) => groupIds.includes(g.id))
    .map((g) => g.name);
  const id = createRun(runName(names, kinds), targets, 'manual');
  if (id) void runNow(id, { foreground: true });
  return id;
}
