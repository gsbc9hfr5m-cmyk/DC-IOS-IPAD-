import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { runNow } from '@/engine/runController';
import type { Preset } from '@/presets/types';
import { strings } from '@/strings';
import { GlassButton, GlassCard, LabelWithHelp, Text } from '@/ui/components';

import { describeSchedule } from './schedule';
import { duePresets, markScheduleHandled, startScheduledRun } from './scheduler';

const s = strings.schedule;

/** 앱을 열었을 때 실행 시각이 지난 스케줄이 있으면 "지금 실행할까요?" (spec 2-9) */
export function MissedSchedules() {
  const [due, setDue] = useState<Preset[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(useCallback(() => setDue(duePresets()), []));

  if (!due.length) return null;
  const p = due[0]!;

  const run = () =>
    Alert.alert(s.runNowTitle, s.runNowBody(p.name), [
      { text: strings.common.cancel, style: 'cancel' },
      {
        text: s.runNowOk,
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          setError(null);
          try {
            const id = await startScheduledRun(p);
            if (id) void runNow(id, { foreground: true });
            else setError(s.nothingToDo);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
            setDue(duePresets());
          }
        },
      },
    ]);

  return (
    <GlassCard>
      <LabelWithHelp label={s.missedTitle} help="schedule" variant="headline" />
      <Text>{p.name}</Text>
      <Text variant="footnote" secondary>
        {describeSchedule(p.schedule!, strings.presets.weekdayNames)}
      </Text>
      {error ? <Text variant="footnote" secondary>{error}</Text> : null}
      <View style={styles.row}>
        <View style={styles.flex}>
          <GlassButton label={busy ? s.preparing : s.runNowOk} icon="play" prominent disabled={busy} onPress={run} />
        </View>
        <View style={styles.flex}>
          <GlassButton
            label={s.skip}
            disabled={busy}
            onPress={() => {
              markScheduleHandled(p.id);
              setDue(duePresets());
            }}
          />
        </View>
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, paddingTop: 4 },
  flex: { flex: 1 },
});
