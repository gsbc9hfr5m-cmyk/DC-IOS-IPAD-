import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { RunCard } from '@/engine/RunCard';
import { refreshRunState, useRun } from '@/engine/runController';
import { MissedSchedules } from '@/schedule/MissedSchedules';
import { useSession } from '@/services/session';
import { strings } from '@/strings';
import { GlassButton, GlassCard, LabelWithHelp, Text } from '@/ui/components';
import { Icon } from '@/ui/icons';
import { Screen } from '@/ui/Screen';

/** 홈: 현재 작업 상태, 시작/일시정지, 최근 결과 */
export default function HomeScreen() {
  const router = useRouter();
  const loggedIn = useSession((st) => st.status === 'loggedIn');
  const { active, last } = useRun();
  useFocusEffect(useCallback(() => refreshRunState(), []));

  return (
    <>
      <Stack.Screen options={{ title: strings.appName }} />
      <Screen>
        <MissedSchedules />
        {active ? (
          <RunCard run={active} />
        ) : (
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
        )}

        {!active ? (
          <View style={styles.actions}>
            <GlassButton label={strings.home.run} icon="play" help="runCleaner" prominent disabled={!loggedIn} onPress={() => router.navigate('/presets')} />
            {loggedIn ? (
              <Text variant="footnote" secondary>
                {strings.home.pickPreset}
              </Text>
            ) : (
              <Text variant="footnote" secondary>
                {strings.home.loginNeeded}
              </Text>
            )}
          </View>
        ) : null}

        <GlassCard>
          <LabelWithHelp label={strings.home.recentTitle} variant="headline" />
          {last ? (
            <>
              <Text>{`${last.presetName} · ${strings.run.status[last.status]}`}</Text>
              <Text variant="footnote" secondary>
                {strings.run.last(new Date(last.finishedAt ?? last.updatedAt).toLocaleString('ko-KR'), last.counts.deleted)}
              </Text>
              <Text variant="footnote" secondary>
                {strings.run.counts(last.counts.deleted, last.counts.failed, last.counts.skipped, last.counts.protected, last.counts.unverified)}
              </Text>
            </>
          ) : (
            <Text secondary>{strings.home.recentEmpty}</Text>
          )}
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
