/**
 * 단축어 URL scheme (spec 2-12).
 * App Intents는 Swift 네이티브 확장이 필요해 Expo(관리형)에서 바로 만들 수 없으므로 URL scheme으로 대체한다.
 *   dccleaner://pause
 *   dccleaner://resume
 *   dccleaner://status
 * 어떤 경로로 들어와도 확인 → 백업 → 보호 검사 → 삭제 → 응답 검증 순서는 같다 (앱 안 확인 창 필수).
 */
export type ShortcutAction =
  | { action: 'pause' }
  | { action: 'resume' }
  | { action: 'status' };

export const SCHEME = 'dccleaner';

/** 'dccleaner://pause' 또는 expo-router가 넘기는 '/pause' 모두 받는다. 삭제 시작은 단축어로 할 수 없다 (앱에서 갤러리를 골라야 함). */
export function parseShortcutUrl(url: string): ShortcutAction | null {
  const m = /^(?:dccleaner:\/\/\/?|\/)?([a-z]+)\/?(?:\?(.*))?$/i.exec(url.trim());
  if (!m) return null;
  const action = m[1]!.toLowerCase();
  const params = new Map<string, string>();
  for (const pair of (m[2] ?? '').split('&').filter(Boolean)) {
    const [k = '', v = ''] = pair.split('=');
    try {
      params.set(decodeURIComponent(k), decodeURIComponent(v.replace(/\+/g, ' ')));
    } catch {
      return null;
    }
  }
  switch (action) {
    case 'pause':
    case 'resume':
    case 'status':
      return { action };
    default:
      return null;
  }
}

export function shortcutUrl(a: ShortcutAction): string {
  return `${SCHEME}://${a.action}`;
}
