/**
 * 수집 상태 (화면 표시용). 한 번에 하나의 수집만 돈다.
 */
import { create } from 'zustand';

import * as repos from '@/db/repos';
import { isDcError } from '@/dc/errors';
import { dc, ensureSession } from '@/services/session';

import { CollectCancelled, collectGallog, collectGuestbook, type CollectKind, type CollectProgress } from './collector';

type State = {
  running: boolean;
  progress: CollectProgress | null;
  error: string | null;
  /** 수집이 끝날 때마다 증가 → 화면이 캐시를 다시 읽는다 */
  version: number;
};

export const useCollect = create<State>()(() => ({ running: false, progress: null, error: null, version: 0 }));

let abort: { aborted: boolean } | null = null;

export function collectedAt(kind: CollectKind): string | null {
  return repos.getMeta(`collected.${kind}`);
}

export async function startCollect(kinds: CollectKind[]): Promise<boolean> {
  if (useCollect.getState().running) return false;
  abort = { aborted: false };
  useCollect.setState({ running: true, error: null, progress: null });
  const signal = abort;
  try {
    await ensureSession();
    const opts = {
      client: dc,
      sink: repos,
      signal,
      onProgress: (p: CollectProgress) => useCollect.setState({ progress: p }),
    };
    for (const kind of kinds) {
      if (kind === 'guestbook') await collectGuestbook(opts);
      else await collectGallog(kind, opts);
    }
    return true;
  } catch (e) {
    const msg = e instanceof CollectCancelled ? e.message : isDcError(e) ? e.message : '목록 수집 중 오류가 발생했습니다.';
    useCollect.setState({ error: msg });
    return false;
  } finally {
    abort = null;
    useCollect.setState((s) => ({ running: false, progress: null, version: s.version + 1 }));
  }
}

export function cancelCollect(): void {
  if (abort) abort.aborted = true;
}
