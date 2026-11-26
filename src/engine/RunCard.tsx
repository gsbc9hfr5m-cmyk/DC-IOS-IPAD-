import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { requireReauth } from '@/security/auth';
import { strings } from '@/strings';
import { colors } from '@/ui/colors';
import { GlassButton, GlassCard, LabelWithHelp, Text } from '@/ui/components';
import { Icon } from '@/ui/icons';

import { cancelRun, pauseRun, runNow, useRun } from './runController';
import type { RunSummary } from './types';

const r = strings.run;

function ProgressBar({ value }: { value: number }) {
  return (
    <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}>
      <View style={[styles.fill, { width: `${Math.min(100, Math.max(0, value * 100))}%` }]} />
    </View>
  );
}

/** 진행 중인 작업 카드 (리퀴드 글래스). 진행률, 남은 개수, 일시정지/재개/취소. */
export function RunCard({ run }: { run: RunSummary }) {
  const current = useRun((s) => s.current);
  const engineRunning = useRun((s) => s.engineRunning);
  const [copied, setCopied] = useState(false);
  const c = run.counts;
  const done = run.total - c.pending;
  const remainingMin = Math.max(1, Math.ceil((c.pending * 2 * 5.5) / 60));
  const [message, debug] = (run.haltReason ?? '').split('\n');

  const resume = async () => {
    if (!(await requireReauth('runStart'))) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void runNow(run.id, { foreground: true });
  };

  const cancel = () =>
    Alert.alert(r.cancel, r.cancelConfirm, [
      { text: strings.common.cancel, style: 'cancel' },
      { text: r.cancel, style: 'destructive', onPress: () => cancelRun(run.id) },
    ]);

  return (
    <GlassCard>
      <View style={styles.head}>
        <Icon name={run.status === 'running' ? 'play' : run.status === 'halted' ? 'warning' : 'pause'} color={run.status === 'halted' ? 'tint' : 'primary'} size={26} />
        <View style={styles.flex}>
          <Text variant="headline">{`${r.status[run.status]} · ${run.presetName}`}</Text>
          <Text variant="footnote" secondary>
            {r.progress(done, run.total)}
          </Text>
        </View>
      </View>
      <ProgressBar value={run.total ? done / run.total : 0} />
      <Text variant="footnote" secondary>
        {r.counts(c.deleted, c.failed, c.skipped, c.protected, c.unverified)}
      </Text>
      {c.pending ? <Text variant="footnote" secondary>{r.remaining(c.pending, remainingMin)}</Text> : null}
      {engineRunning && current ? (
        <Text variant="footnote" secondary numberOfLines={1}>
          {`${r.current}: ${current}`}
        </Text>
      ) : null}
      {message ? <Text variant="footnote" style={{ color: run.status === 'halted' ? colors.destructive : colors.secondaryLabel }}>{message}</Text> : null}

      <View style={styles.actions}>
        {engineRunning ? (
          <View style={styles.flex}>
            <GlassButton label={r.pause} icon="pause" onPress={pauseRun} />
          </View>
        ) : (
          <View style={styles.flex}>
            <GlassButton label={r.resume} icon="play" help="runCleaner" prominent onPress={() => void resume()} />
          </View>
        )}
        <View style={styles.flex}>
          <GlassButton label={r.cancel} icon="stop" onPress={cancel} disabled={engineRunning} />
        </View>
      </View>
      {run.status === 'halted' && debug ? (
        <GlassButton
          label={copied ? r.copied : r.copyDebug}
          icon="debug"
          onPress={() => {
            void Clipboard.setStringAsync(`${message}\n${debug}\nrun=${run.id}`);
            setCopied(true);
          }}
        />
      ) : null}
      <LabelWithHelp label={strings.settings.backgroundLimits} help="backgroundLimits" variant="footnote" />
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.separator, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.tint },
  actions: { flexDirection: 'row', gap: 10, paddingTop: 4 },
});
