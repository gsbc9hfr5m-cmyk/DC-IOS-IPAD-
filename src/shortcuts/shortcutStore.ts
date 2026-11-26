import { create } from 'zustand';

import type { ShortcutAction } from './shortcutUrl';

/** 들어온 단축어 동작 대기열 (+native-intent → ShortcutHandler) */
export const useShortcutQueue = create<{ pending: ShortcutAction | null }>()(() => ({ pending: null }));

export function enqueueShortcut(a: ShortcutAction) {
  useShortcutQueue.setState({ pending: a });
}

export function takeShortcut(): ShortcutAction | null {
  const p = useShortcutQueue.getState().pending;
  useShortcutQueue.setState({ pending: null });
  return p;
}
