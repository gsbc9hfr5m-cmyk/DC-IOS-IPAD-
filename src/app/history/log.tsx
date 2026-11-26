import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, TextInput, View } from 'react-native';

import { filterHistory, historyToCsv, historyToJson, KIND_LABEL, RESULT_LABEL, type HistoryFilter, type HistoryRow } from '@/history/historyFormat';
import { loadHistory } from '@/history/historyRepo';
import { strings } from '@/strings';
import { colors } from '@/ui/colors';
import { Chip, GlassButton, Text } from '@/ui/components';
import { exportsDir, shareUri, timestampForFile, writeTextFile } from '@/util/files';

const h = strings.history;
const RESULTS = ['all', 'deleted', 'failed', 'skipped', 'protected', 'unverified'] as const;
const KINDS = ['all', 'post', 'comment', 'guestbook'] as const;

/** 삭제 이력: 검색, 필터, JSON/CSV 내보내기 (spec 2-14) */
export default function HistoryLogScreen() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [f, setF] = useState<HistoryFilter>({ query: '', result: 'all', kind: 'all' });
  useFocusEffect(useCallback(() => setRows(loadHistory()), []));
  const shown = useMemo(() => filterHistory(rows, f), [rows, f]);

  const exportAs = async (kind: 'json' | 'csv') => {
    const text = kind === 'json' ? historyToJson(shown) : historyToCsv(shown);
    const file = writeTextFile(exportsDir(), `history-${timestampForFile()}.${kind}`, text);
    await shareUri(file.uri, h.deletions);
  };

  return (
    <>
      <Stack.Screen options={{ title: h.deletions, headerLargeTitle: false }} />
      <FlatList
        style={styles.list}
        contentInsetAdjustmentBehavior="automatic"
        data={shown.slice(0, 500)}
        keyExtractor={(r) => String(r.id)}
        ListHeaderComponent={
          <View style={styles.header}>
            <TextInput
              value={f.query}
              onChangeText={(query) => setF({ ...f, query })}
              placeholder={h.searchPlaceholder}
              placeholderTextColor={colors.tertiaryLabel}
              style={styles.search}
              clearButtonMode="while-editing"
              autoCapitalize="none"
            />
            <View style={styles.chips}>
              {RESULTS.map((r) => (
                <Chip key={r} label={r === 'all' ? h.all : RESULT_LABEL[r]} selected={f.result === r} onPress={() => setF({ ...f, result: r })} />
              ))}
            </View>
            <View style={styles.chips}>
              {KINDS.map((k) => (
                <Chip key={k} label={k === 'all' ? h.all : KIND_LABEL[k]} selected={f.kind === k} onPress={() => setF({ ...f, kind: k })} />
              ))}
            </View>
            <View style={styles.row}>
              <View style={styles.flex}>
                <GlassButton label={h.exportJson} icon="archive" disabled={!shown.length} onPress={() => void exportAs('json')} />
              </View>
              <View style={styles.flex}>
                <GlassButton label={h.exportCsv} icon="doc" disabled={!shown.length} onPress={() => void exportAs('csv')} />
              </View>
            </View>
            <Text variant="footnote" secondary>
              {shown.length ? h.shown(Math.min(shown.length, 500), rows.length) : h.empty}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.item}>
            <Text numberOfLines={1}>{item.title || '(제목 없음)'}</Text>
            <Text variant="caption" secondary numberOfLines={2}>
              {[new Date(item.at).toLocaleString('ko-KR'), KIND_LABEL[item.kind], item.galleryId, RESULT_LABEL[item.result], item.reason]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        )}
      />
    </>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.background },
  header: { padding: 16, gap: 10 },
  search: { minHeight: 44, borderRadius: 12, paddingHorizontal: 14, fontSize: 17, color: colors.label, backgroundColor: colors.secondaryBackground },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  item: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 2,
    backgroundColor: colors.secondaryBackground,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
});
