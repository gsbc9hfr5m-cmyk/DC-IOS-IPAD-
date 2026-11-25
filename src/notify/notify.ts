/**
 * 로컬 알림 (spec 2-8-4). 외부 푸시 서버는 쓰지 않는다. 7단계에서 종류별 설정을 추가한다.
 */
import * as Notifications from 'expo-notifications';

let configured = false;

function configure() {
  if (configured) return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export async function ensureNotificationPermission(): Promise<boolean> {
  configure();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/** 즉시 로컬 알림. 권한이 없으면 조용히 무시한다. */
export function notifyNow(title: string, body: string): void {
  void (async () => {
    try {
      if (!(await ensureNotificationPermission())) return;
      await Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: null });
    } catch {
      // 알림 실패는 작업 흐름에 영향을 주지 않는다
    }
  })();
}
