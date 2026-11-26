import * as Clipboard from 'expo-clipboard';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { clearLogs, debugLogFileUri, readCrashLog, readDebugLog } from '@/debug/debugLog';
import { useSettings } from '@/settings/settingsStore';
import { strings } from '@/strings';
import { colors } from '@/ui/colors';
import { Chip, GlassButton, GlassCard, LabelWithHelp, Text } from '@/ui/components';
import { Screen } from '@/ui/Screen';
import { shareUri } from '@/util/files';

const d = strings.debug;

/** 디버그 기록 열람/복사/내보내기 (spec 2-16). 외부 전송은 하지 않는다 (공유 시트는 사용자가 직접 고름). */
export default function DebugScreen() {
  const debugMode = useSettings((s) => s.debugMode);
  const [tab, setTab] = useState<'requests' | 'crashes'>('requests');
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);
  const load = useCallback(() => {
    const raw = tab === 'requests' ? readDebugLog() : readCrashLog();
    // 최근 200줄만 화면에 보인다
    setText(raw.split('\n').filter(Boolean).slice(-200).reverse().join('\n'));
    setCopied(false);
  }, [tab]);
  useFocusEffect(load);

  return (
    <>
      <Stack.Screen options={{ title: d.title, headerLargeTitle: false }} />
      <Screen>
        <GlassCard>
          <LabelWithHelp label={d.title} help="debugMode" variant="headline" />
          {!debugMode ? <Text variant="footnote" secondary>{d.off}</Text> : null}
          <Text variant="footnote" secondary>
            {d.note}
          </Text>
        </GlassCard>
        <View style={styles.chips}>
          <Chip label={d.requests} selected={tab === 'requests'} onPress={() => setTab('requests')} />
          <Chip label={d.crashes} selected={tab === 'crashes'} onPress={() => setTab('crashes')} />
        </View>
        <View style={styles.row}>
          <View style={styles.flex}>
            <GlassButton
              label={copied ? d.copied : d.copy}
              icon="doc"
              disabled={!text}
              onPress={() => {
                void Clipboard.setStringAsync(text);
                setCopied(true);
              }}
            />
          </View>
          <View style={styles.flex}>
            <GlassButton
              label={d.exportFile}
              icon="archive"
              disabled={!text}
              onPress={() => void shareUri(debugLogFileUri(tab === 'requests' ? 'debug.jsonl' : 'crash.log'), d.title)}
            />
          </View>
        </View>
        <GlassButton
          label={d.clear}
          icon="trash"
          onPress={() =>
            Alert.alert(d.clear, d.clearConfirm, [
              { text: strings.common.cancel, style: 'cancel' },
              {
                text: d.clear,
                style: 'destructive',
                onPress: () => {
                  clearLogs();
                  load();
                },
              },
            ])
          }
        />
        <GlassCard>
          <Text variant="caption" style={styles.mono} selectable>
            {text || d.empty}
          </Text>
        </GlassCard>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', gap: 8 },
  row: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  mono: { fontFamily: 'Menlo', color: colors.label },
});
