import { BlurView } from 'expo-blur';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Modal, StyleSheet, View, type AppStateStatus } from 'react-native';

import { useSettings } from '@/settings/settingsStore';
import { strings } from '@/strings';
import { GlassButton, Text } from '@/ui/components';
import { GlassSurface } from '@/ui/glass';
import { Icon } from '@/ui/icons';

import { authenticate } from './auth';
import { shouldLockOnReturn } from './lockLogic';

/**
 * 앱 잠금 (spec 2-10).
 * - 켜져 있으면 앱 시작 시 잠긴다.
 * - 백그라운드로 가면 앱 전환 화면 미리보기를 블러로 가린다.
 * - 돌아왔을 때 설정한 시간(즉시/1분/5분)이 지났으면 다시 잠근다.
 * - 생체 인증에 실패하면 기기 암호로 풀 수 있다 (auth.ts).
 */
export function AppLockGate() {
  const enabled = useSettings((s) => s.appLock);
  const delay = useSettings((s) => s.lockDelaySec);
  const [locked, setLocked] = useState(enabled);
  const [privacy, setPrivacy] = useState(false);
  const backgroundedAt = useRef<number | null>(null);
  const authInFlight = useRef(false);

  const unlock = useCallback(async () => {
    if (authInFlight.current) return;
    authInFlight.current = true;
    try {
      if (await authenticate('unlock')) setLocked(false);
    } finally {
      authInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const onChange = (state: AppStateStatus) => {
      if (state === 'inactive' || state === 'background') {
        // 인증 시트 자체도 inactive를 일으키므로 인증 중에는 가리지 않는다
        if (authInFlight.current) return;
        setPrivacy(true);
        if (backgroundedAt.current === null) backgroundedAt.current = Date.now();
      } else if (state === 'active') {
        setPrivacy(false);
        if (shouldLockOnReturn(delay, backgroundedAt.current, Date.now())) setLocked(true);
        backgroundedAt.current = null;
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [enabled, delay]);

  // 잠기면 자동으로 한 번 인증을 띄운다
  useEffect(() => {
    if (enabled && locked && AppState.currentState === 'active') void unlock();
  }, [enabled, locked, unlock]);

  if (!enabled || (!locked && !privacy)) return null;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent>
      <BlurView intensity={100} tint="systemThickMaterial" style={StyleSheet.absoluteFill} />
      {locked ? (
        <View style={styles.center}>
          <GlassSurface style={styles.card}>
            <Icon name="lock" size={40} color="primary" />
            <Text variant="title">{strings.appName}</Text>
            <Text secondary>{strings.lock.locked}</Text>
            <GlassButton label={strings.lock.unlock} icon="lock" prominent onPress={() => void unlock()} />
          </GlassSurface>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  card: { padding: 28, gap: 14, alignItems: 'center', alignSelf: 'stretch' },
});
