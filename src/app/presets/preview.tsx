import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';

import { cancelCollect, collectedAt, startCollect, useCollect } from '@/collect/collectStore';
import type { CollectKind } from '@/collect/collector';
import { getPreset } from '@/db/repos';
import type { Target } from '@/presets/filter';
import { ProtectableRow } from '@/presets/ProtectableRow';
import { usePlan } from '@/presets/usePlan';
import { RunButton } from '@/engine/RunButton';
import { strings } from '@/strings';
import { colors } from '@/ui/colors';
import { GlassButton, GlassCard, LabelWithHelp, Text } from '@/ui/components';

const p = strings.preview;
const KIND_LABEL: Record<CollectKind, string> = { post: '글', comment: '댓글', guestbook: '방명록' };
const MAX_ROWS = 300;

function formatAt(iso: string | null): string {
  if (!iso) return p.cacheNever;
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 삭제 1건에 요청 2~3개, 분당 약 15회 → 분당 약 5건 */
export function estimateRunMinutes(n: number, withBackupFetch: number): number {
  const requests = n * 2 + withBackupFetch;
  return Math.max(1, Math.ceil((requests * 5.5) / 60));
}

export default function PreviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const preset = useMemo(() => (id ? getPreset(id) : null), [id]);
  const { plan, toggleProtect } = usePlan(preset);
  const collect = useCollect();

  const kinds = useMemo<CollectKind[]>(() => {
    if (!preset) return [];
    const k = preset.config.kinds;
    return [k.post && 'post', k.comment && 'comment', k.guestbook && preset.config.guestbook.onMyGallog && 'guestbook'].filter(
      Boolean,
    ) as CollectKind[];
  }, [preset]);

  if (!preset || !plan) return null;

  const rows: (Target & { prot: boolean })[] = [
    ...plan.targets.slice(0, MAX_ROWS).map((t) => ({ ...t, prot: false })),
    ...plan.protectedMatches.map((t) => ({ ...t, prot: true })),
  ];
  const total = plan.targets.length;
  const postsNeedingFetch = plan.targets.filter((t) => t.kind === 'post').length;
  const years = Object.entries(plan.guestbookByYear).sort(([a], [b]) => Number(b) - Number(a));

  const header = (
    <View style={styles.header}>
      <GlassCard>
        <LabelWithHelp label={p.cacheTitle} help="collectList" variant="headline" />
        {kinds.map((k) => (
          <Text key={k} variant="footnote" secondary>
            {p.cacheAt(KIND_LABEL[k], formatAt(collectedAt(k)))}
          </Text>
        ))}
        {collect.running && collect.progress ? (
          <View style={styles.progress}>
            <ActivityIndicator />
            <Text variant="footnote" secondary style={styles.flex}>
              {collect.progress.waitingMs
                ? p.waiting(Math.ceil(collect.progress.waitingMs / 1000))
                : p.collectProgress(
                    `${KIND_LABEL[collect.progress.kind]}${collect.progress.year ? ` ${collect.progress.year}년` : ''}`,
                    collect.progress.page,
                    collect.progress.lastPage,
                    collect.progress.collected,
                  )}
            </Text>
          </View>
        ) : null}
        {collect.error ? <Text variant="footnote" style={{ color: colors.destructive }}>{collect.error}</Text> : null}
      </GlassCard>
      {collect.running ? (
        <GlassButton label={p.cancelCollect} icon="stop" onPress={cancelCollect} />
      ) : (
        <GlassButton label={p.collect} icon="reload" help="collectList" onPress={() => void startCollect(kinds)} disabled={!kinds.length} />
      )}

      <GlassCard>
        <LabelWithHelp label={p.summary} help="dryRun" variant="headline" />
        <Text variant="title">{p.total(total)}</Text>
        <Text secondary>
          {(['post', 'comment', 'guestbook'] as const)
            .filter((k) => plan.counts[k])
            .map((k) => `${KIND_LABEL[k]} ${plan.counts[k]}`)
            .join(' · ') || p.empty}
        </Text>
        {plan.protectedMatches.length ? <Text style={{ color: colors.tint }}>{p.protectedCount(plan.protectedMatches.length)}</Text> : null}
        {total ? <Text variant="footnote" secondary>{p.estimate(estimateRunMinutes(total, postsNeedingFetch))}</Text> : null}
        {plan.targets.some((t) => t.needsMetrics) ? <Text variant="footnote" secondary>{p.metricsNote}</Text> : null}
      </GlassCard>

      {years.length ? (
        <GlassCard>
          <LabelWithHelp label={p.byYear} help="guestbookYears" variant="headline" />
          {years.map(([y, n]) => {
            const samples = plan.targets.filter((t) => t.kind === 'guestbook' && t.writtenAt.startsWith(y)).slice(0, 2);
            return (
              <View key={y} style={styles.yearRow}>
                <Text variant="callout">{`${y}년 · ${n}개`}</Text>
                {samples.map((t) => (
                  <Text key={t.key} variant="caption" secondary numberOfLines={1}>
                    {`“${t.title}”`}
                  </Text>
                ))}
              </View>
            );
          })}
        </GlassCard>
      ) : null}

      <Text variant="footnote" secondary style={styles.pad}>
        {p.longPressHint}
      </Text>
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: `${p.title}: ${preset.name}`, headerLargeTitle: false }} />
      <FlatList
        style={styles.list}
        contentInsetAdjustmentBehavior="automatic"
        data={rows}
        keyExtractor={(t) => t.key}
        ListHeaderComponent={header}
        renderItem={({ item }) => <ProtectableRow target={item} isProtected={item.prot} onToggle={toggleProtect} />}
        ListFooterComponent={
          <View style={styles.footer}>
            {plan.targets.length > MAX_ROWS ? (
              <Text variant="footnote" secondary style={styles.pad}>
                {p.moreItems(plan.targets.length - MAX_ROWS)}
              </Text>
            ) : null}
            <RunButton preset={preset} plan={plan} />
          </View>
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.background },
  header: { padding: 16, gap: 14 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 4 },
  yearRow: { gap: 2, paddingTop: 4 },
  pad: { paddingHorizontal: 16 },
  footer: { padding: 16, gap: 10, paddingBottom: 48 },
  flex: { flex: 1 },
});
