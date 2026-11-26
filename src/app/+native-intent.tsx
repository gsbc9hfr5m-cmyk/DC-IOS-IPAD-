/**
 * 외부 URL(dccleaner://…)이 들어오면 expo-router가 화면 이동 전에 이 함수를 부른다.
 * 단축어 동작이면 대기열에 넣고 홈으로 보낸다 (실제 처리는 ShortcutHandler가 확인 창과 함께 한다).
 */
import { enqueueShortcut } from '@/shortcuts/shortcutStore';
import { parseShortcutUrl } from '@/shortcuts/shortcutUrl';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  const action = parseShortcutUrl(path);
  if (action) {
    enqueueShortcut(action);
    return '/';
  }
  return path;
}
