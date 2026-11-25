import * as Haptics from 'expo-haptics';
import Storage from 'expo-sqlite/kv-store';
import { useState, type ReactNode } from 'react';
import { Modal, StyleSheet, View } from 'react-native';

import { strings } from '@/strings';
import { GlassButton, Text } from '@/ui/components';
import { colors } from '@/ui/colors';
import { GlassSurface } from '@/ui/glass';
import { Icon } from '@/ui/icons';

const KEY = 'onboarding.v1.done';

function readDone(): boolean {
  try {
    return Storage.getItemSync(KEY) === '1';
  } catch {
    return false;
  }
}

/** 첫 실행 1회: "(!) 아이콘을 누르면 설명이 나옵니다" 안내 */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const [done, setDone] = useState(readDone);

  const finish = () => {
    try {
      Storage.setItemSync(KEY, '1');
    } catch {
      // 저장 실패 시 다음 실행에 한 번 더 보일 뿐이다
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setDone(true);
  };

  return (
    <>
      {children}
      <Modal visible={!done} animationType="slide" presentationStyle="pageSheet" onRequestClose={finish}>
        <View style={styles.sheet}>
          <Text variant="largeTitle">{strings.onboarding.title}</Text>
          <GlassSurface style={styles.card}>
            <View style={styles.row}>
              <Icon name="help" color="tint" size={28} />
              <Text style={styles.flex}>{strings.onboarding.helpHint}</Text>
            </View>
            <View style={styles.row}>
              <Icon name="warning" color="secondary" size={28} />
              <Text style={styles.flex}>{strings.onboarding.irreversible}</Text>
            </View>
          </GlassSurface>
          <View style={styles.flex} />
          <GlassButton label={strings.onboarding.start} prominent onPress={finish} />
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, padding: 24, paddingTop: 40, gap: 24, backgroundColor: colors.background },
  card: { padding: 20, gap: 20 },
  row: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  flex: { flex: 1 },
});
