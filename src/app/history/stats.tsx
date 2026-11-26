import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';

import { computeStats, KIND_LABEL, type HistoryRow, type Period } from '@/history/historyFormat';
import { loadHistory } from '@/history/historyRepo';
import { strings } from '@/strings';
import { colors } from '@/ui/colors';
import { Chip, GlassCard, LabelWithHelp, Text } from '@/ui/components';
import { Screen } from '@/ui/Screen';

const h = strings.history;

/** 가로 막대 (갤러리별) */
function HBars({ data, width }: { data: { label: string; value: number }[]; width: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const rowH = 26;
  const labelW = Math.min(130, width * 0.38);
  const barW = width - labelW - 44;
  return (
    <Svg width={width} height={data.length * rowH} accessibilityLabel={h.statsGalleries}>
      {data.map((d, i) => (
        <SvgText key={`l${d.label}`} x={0} y={i * rowH + 17} fontSize={13} fill={colors.label as unknown as string}>
          {d.label.length > 14 ? `${d.label.slice(0, 13)}…` : d.label}
        </SvgText>
      ))}
      {data.map((d, i) => (
        <Rect key={`b${d.label}`} x={labelW} y={i * rowH + 6} width={Math.max(2, (d.value / max) * barW)} height={14} rx={4} fill={colors.tint as unknown as string} />
      ))}
      {data.map((d, i) => (
        <SvgText key={`v${d.label}`} x={labelW + Math.max(2, (d.value / max) * barW) + 6} y={i * rowH + 17} fontSize={12} fill={colors.secondaryLabel as unknown as string}>
          {String(d.value)}
        </SvgText>
      ))}
    </Svg>
  );
}

/** 세로 막대 (기간별 추이) */
function VBars({ data, width }: { data: { label: string; value: number }[]; width: number }) {
  const height = 150;
  const max = Math.max(1, ...data.map((d) => d.value));
  const slot = width / Math.max(1, data.length);
  const bw = Math.max(4, slot * 0.6);
  return (
    <Svg width={width} height={height + 22} accessibilityLabel={h.statsTrend}>
      {data.map((d, i) => {
        const bh = Math.max(2, (d.value / max) * height);
        return <Rect key={d.label} x={i * slot + (slot - bw) / 2} y={height - bh} width={bw} height={bh} rx={3} fill={colors.tint as unknown as string} />;
      })}
      {data.map((d, i) =>
        i % Math.ceil(data.length / 6) === 0 ? (
          <SvgText key={`t${d.label}`} x={i * slot + slot / 2} y={height + 16} fontSize={10} textAnchor="middle" fill={colors.secondaryLabel as unknown as string}>
            {d.label.slice(5)}
          </SvgText>
        ) : null,
      )}
    </Svg>
  );
}

/** 통계 (spec 2-13): 갤러리별, 기간별, 글/댓글/방명록 비율, 성공/실패율. 이 기기의 기록으로만 계산한다. */
export default function StatsScreen() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [period, setPeriod] = useState<Period>('week');
  const { width } = useWindowDimensions();
  const chartW = Math.min(width, 700) - 32 - 32;
  useFocusEffect(useCallback(() => setRows(loadHistory()), []));
  const s = useMemo(() => computeStats(rows, period), [rows, period]);
  const kindTotal = s.byKind.post + s.byKind.comment + s.byKind.guestbook;

  return (
    <>
      <Stack.Screen options={{ title: h.stats, headerLargeTitle: false }} />
      <Screen>
        {s.total === 0 ? <Text secondary>{h.statsEmpty}</Text> : null}
        <GlassCard>
          <LabelWithHelp label={h.statsSummary} help="stats" variant="headline" />
          <Text variant="title">{h.statsDeleted(s.deleted)}</Text>
          <Text secondary>{h.statsSuccess(s.successRate === null ? '-' : `${Math.round(s.successRate * 1000) / 10}%`)}</Text>
          <Text variant="footnote" secondary>
            {strings.run.counts(s.byResult.deleted, s.byResult.failed, s.byResult.skipped, s.byResult.protected, s.byResult.unverified)}
          </Text>
        </GlassCard>

        <GlassCard>
          <LabelWithHelp label={h.statsKinds} variant="headline" />
          <View style={styles.ratio}>
            {(['post', 'comment', 'guestbook'] as const).map((k, i) =>
              s.byKind[k] ? (
                <View
                  key={k}
                  style={{ flex: s.byKind[k], backgroundColor: colors.tint, opacity: 1 - i * 0.3, height: 14 }}
                  accessibilityLabel={`${KIND_LABEL[k]} ${s.byKind[k]}`}
                />
              ) : null,
            )}
          </View>
          <Text variant="footnote" secondary>
            {(['post', 'comment', 'guestbook'] as const)
              .map((k) => `${KIND_LABEL[k]} ${s.byKind[k]}${kindTotal ? ` (${Math.round((s.byKind[k] / kindTotal) * 100)}%)` : ''}`)
              .join(' · ')}
          </Text>
        </GlassCard>

        {s.byGallery.length ? (
          <GlassCard>
            <LabelWithHelp label={h.statsGalleries} variant="headline" />
            <HBars data={s.byGallery.slice(0, 10).map((g) => ({ label: g.galleryId, value: g.count }))} width={chartW} />
          </GlassCard>
        ) : null}

        <GlassCard>
          <LabelWithHelp label={h.statsTrend} variant="headline" />
          <View style={styles.chips}>
            {(['day', 'week', 'month'] as const).map((p) => (
              <Chip key={p} label={h.period[p]} selected={period === p} onPress={() => setPeriod(p)} />
            ))}
          </View>
          {s.trend.length ? <VBars data={s.trend.map((t) => ({ label: t.key, value: t.count }))} width={chartW} /> : <Text secondary>{h.statsEmpty}</Text>}
        </GlassCard>
        <Text variant="footnote" secondary>
          {h.statsLocal}
        </Text>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  ratio: { flexDirection: 'row', borderRadius: 7, overflow: 'hidden', gap: 2 },
  chips: { flexDirection: 'row', gap: 8, paddingBottom: 6 },
});
