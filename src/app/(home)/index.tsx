import { Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { strings } from '@/strings';
import { GlassButton, GlassCard, LabelWithHelp, Text } from '@/ui/components';
import { Icon } from '@/ui/icons';
import { Screen } from '@/ui/Screen';

/** 홈: 현재 작업 상태, 시작/일시정지, 최근 결과 (엔진은 6단계에서 연결) */
export default function HomeScreen() {
  return (
    <>
      <Stack.Screen options={{ title: strings.appName }} />
      <Screen>
        <GlassCard>
          <LabelWithHelp label={strings.home.statusTitle} help="backgroundLimits" variant="headline" />
          <View style={styles.status}>
            <Icon name="pause" color="secondary" size={28} />
            <View style={styles.flex}>
              <Text variant="title">{strings.home.statusIdle}</Text>
              <Text secondary>{strings.home.statusIdleDetail}</Text>
            </View>
          </View>
        </GlassCard>

        <View style={styles.actions}>
          <GlassButton label={strings.home.dryRun} icon="doc" help="dryRun" disabled />
          <GlassButton label={strings.home.run} icon="play" help="runCleaner" prominent disabled />
          <Text variant="footnote" secondary>
            {strings.home.loginNeeded}
          </Text>
        </View>

        <GlassCard>
          <LabelWithHelp label={strings.home.recentTitle} variant="headline" />
          <Text secondary>{strings.home.recentEmpty}</Text>
        </GlassCard>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 4 },
  actions: { gap: 12 },
});
