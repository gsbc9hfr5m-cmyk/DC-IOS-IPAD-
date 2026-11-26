import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, StyleSheet, View } from 'react-native';

import { addProtected, listProtected, removeProtected, type ProtectedItem } from '@/db/repos';
import { parseProtected, serializeProtected } from '@/presets/protectedJson';
import { strings } from '@/strings';
import { colors } from '@/ui/colors';
import { GlassButton, LabelWithHelp, Text } from '@/ui/components';
import { exportsDir, pickJsonText, shareUri, timestampForFile, writeTextFile } from '@/util/files';

const s = strings.protectedList;
const KIND_LABEL: Record<string, string> = { post: '글', comment: '댓글', guestbook: '방명록' };

export default function ProtectedScreen() {
  const [items, setItems] = useState<ProtectedItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const reload = useCallback(() => setItems(listProtected()), []);
  useFocusEffect(reload);

  const exportJson = async () => {
    const file = writeTextFile(exportsDir(), `protected-${timestampForFile()}.json`, serializeProtected(items));
    await shareUri(file.uri, s.title);
  };

  const importJson = async () => {
    const text = await pickJsonText();
    if (text === null) return;
    const parsed = parseProtected(text);
    if (!parsed) {
      setMessage(s.importFailed);
      return;
    }
    addProtected(parsed);
    setMessage(s.imported(parsed.length));
    reload();
  };

  const confirmRemove = (i: ProtectedItem) =>
    Alert.alert(s.remove, i.title, [
      { text: strings.common.cancel, style: 'cancel' },
      {
        text: s.remove,
        style: 'destructive',
        onPress: () => {
          removeProtected(i.key);
          reload();
        },
      },
    ]);

  return (
    <>
      <Stack.Screen options={{ title: s.title, headerLargeTitle: false }} />
      <FlatList
        style={styles.list}
        contentInsetAdjustmentBehavior="automatic"
        data={items}
        keyExtractor={(i) => i.key}
        ListHeaderComponent={
          <View style={styles.header}>
            <LabelWithHelp label={s.title} help="protectList" variant="headline" />
            <GlassButton label={s.exportJson} icon="archive" onPress={() => void exportJson()} disabled={!items.length} />
            <GlassButton label={s.importJson} icon="add" onPress={() => void importJson()} />
            {message ? <Text variant="footnote" secondary>{message}</Text> : null}
            {!items.length ? <Text secondary>{s.empty}</Text> : null}
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.flex}>
              <Text numberOfLines={2}>{item.title || '(제목 없음)'}</Text>
              <Text variant="caption" secondary>
                {[KIND_LABEL[item.kind] ?? item.kind, item.galleryId, item.writtenAt?.slice(0, 10)].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <GlassButton label={s.remove} onPress={() => confirmRemove(item)} />
          </View>
        )}
      />
    </>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.background },
  header: { padding: 16, gap: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.secondaryBackground,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  flex: { flex: 1, gap: 2 },
});
