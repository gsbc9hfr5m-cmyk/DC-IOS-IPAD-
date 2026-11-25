import { Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { strings } from '@/strings';
import { GlassButton, GlassCard, LabelWithHelp, Text } from '@/ui/components';
import { Icon } from '@/ui/icons';
import { Screen } from '@/ui/Screen';

/** 프리셋 목록 (편집/스케줄은 5·7단계에서 구현) */
export default function PresetsScreen() {
  return (
    <>
      <Stack.Screen options={{ title: strings.presets.title }} />
      <Screen>
        <GlassCard style={styles.empty}>
          <Icon name="tabPresets" size={34} color="secondary" />
          <LabelWithHelp label={strings.presets.empty} help="presets" />
        </GlassCard>
        <View style={styles.actions}>
          <GlassButton label={strings.presets.add} icon="add" help="targetKinds" disabled />
          <Text variant="footnote" secondary>
            {strings.common.comingSoon}
          </Text>
        </View>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', paddingVertical: 32, gap: 12 },
  actions: { gap: 8 },
});
