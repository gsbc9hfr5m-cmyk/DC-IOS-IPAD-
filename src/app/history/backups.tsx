import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { backupsTotalBytes, deleteBackupDir } from '@/engine/backup';
import { formatBytes, listBackups, removeBackupRecord, type BackupEntry } from '@/history/historyRepo';
import { requireReauth } from '@/security/auth';
import { strings } from '@/strings';
import { GlassButton, GlassCard, LabelWithHelp, Text } from '@/ui/components';
import { Screen } from '@/ui/Screen';
import { shareUri } from '@/util/files';

const h = strings.history;
const MONTH_MS = 30 * 86_400_000;

/** 백업 목록: 공유 시트 내보내기, 용량 표시, 오래된 백업 정리 (spec 2-5) */
export default function BackupsScreen() {
  const [items, setItems] = useState<BackupEntry[]>([]);
  const [total, setTotal] = useState(0);
  const reload = useCallback(() => {
    setItems(listBackups());
    try {
      setTotal(backupsTotalBytes());
    } catch {
      setTotal(0);
    }
  }, []);
  useFocusEffect(reload);

  const remove = async (list: BackupEntry[]) => {
    if (!(await requireReauth('backupDelete'))) return;
    for (const b of list) {
      try {
        deleteBackupDir(b.dir);
      } catch {
        // 폴더가 이미 없으면 기록만 지운다
      }
      removeBackupRecord(b.runId);
    }
    reload();
  };

  const confirmRemove = (b: BackupEntry) =>
    Alert.alert(h.remove, h.removeConfirm, [
      { text: strings.common.cancel, style: 'cancel' },
      { text: h.remove, style: 'destructive', onPress: () => void remove([b]) },
    ]);

  const cleanup = () => {
    const old = items.filter((b) => Date.now() - Date.parse(b.createdAt) > MONTH_MS);
    if (!old.length) return Alert.alert(h.cleanupNone);
    Alert.alert(h.cleanup, h.cleanupConfirm(old.length), [
      { text: strings.common.cancel, style: 'cancel' },
      { text: h.remove, style: 'destructive', onPress: () => void remove(old) },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ title: h.backups, headerLargeTitle: false }} />
      <Screen>
        <GlassCard>
          <LabelWithHelp label={h.backupsTotal(formatBytes(total))} help="backupList" variant="headline" />
        </GlassCard>
        <GlassButton label={h.cleanup} icon="trash" onPress={cleanup} disabled={!items.length} />
        {items.length === 0 ? <Text secondary>{h.backupsEmpty}</Text> : null}
        {items.map((b) => (
          <GlassCard key={b.runId}>
            <Text variant="headline">{b.presetName ?? b.runId}</Text>
            <Text variant="footnote" secondary>
              {`${new Date(b.createdAt).toLocaleString('ko-KR')} · ${h.backupItem(b.itemCount, formatBytes(b.bytes))} · ${b.format.toUpperCase()}`}
            </Text>
            <View style={styles.row}>
              <View style={styles.flex}>
                <GlassButton label={h.share} icon="archive" onPress={() => void shareUri(b.dir, b.presetName ?? h.backups)} />
              </View>
              <View style={styles.flex}>
                <GlassButton label={h.remove} icon="trash" onPress={() => confirmRemove(b)} />
              </View>
            </View>
          </GlassCard>
        ))}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, paddingTop: 4 },
  flex: { flex: 1 },
});
