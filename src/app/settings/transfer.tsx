import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { getDb } from '@/db/db';
import { addProtected, listPresets, listProtected, saveGalleryId, savePreset } from '@/db/repos';
import { getSettings, useSettings } from '@/settings/settingsStore';
import { buildExport, parseImport } from '@/settings/transfer';
import { strings } from '@/strings';
import { GlassButton, GlassCard, LabelWithHelp, Text } from '@/ui/components';
import { Screen } from '@/ui/Screen';
import { exportsDir, pickJsonText, shareUri, timestampForFile, writeTextFile } from '@/util/files';

const t = strings.transfer;

/** 설정 백업/복원 (spec 2-15). 비밀번호, API 키, 세션 쿠키는 내보내지 않는다. */
export default function TransferScreen() {
  const [message, setMessage] = useState<string | null>(null);

  const doExport = async () => {
    const galleries = getDb()
      .getAllSync<{ gall_code: string; type_code: string; gall_id: string }>('SELECT * FROM galleries')
      .map((g) => ({ gallCode: g.gall_code, typeCode: g.type_code, gallId: g.gall_id }));
    const text = buildExport({
      settings: getSettings(),
      presets: listPresets(),
      protectedItems: listProtected(),
      galleries,
      appVersion: Constants.expoConfig?.version ?? '0',
    });
    const file = writeTextFile(exportsDir(), `dccleaner-settings-${timestampForFile()}.json`, text);
    await shareUri(file.uri, t.title);
  };

  const doImport = async () => {
    const text = await pickJsonText();
    if (text === null) return;
    const r = parseImport(text);
    if (!r.ok) {
      setMessage(r.error);
      return;
    }
    Alert.alert(t.importConfirmTitle, t.importConfirmBody(r.presets.length, r.protectedItems.length), [
      { text: strings.common.cancel, style: 'cancel' },
      {
        text: t.importOk,
        onPress: () => {
          useSettings.getState().set(r.settings);
          for (const p of r.presets) savePreset({ name: p.name, config: p.config, schedule: p.schedule, scheduleConfirmedAt: null });
          addProtected(r.protectedItems);
          for (const g of r.galleries) saveGalleryId(g.gallCode, g.typeCode, g.gallId);
          setMessage(t.imported(r.presets.length, r.protectedItems.length, r.skippedPresets));
        },
      },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ title: t.title, headerLargeTitle: false }} />
      <Screen>
        <GlassCard>
          <LabelWithHelp label={t.title} help="settingsBackup" variant="headline" />
          <Text secondary>{t.intro}</Text>
        </GlassCard>
        <GlassButton label={t.export} icon="archive" onPress={() => void doExport()} />
        <GlassButton label={t.import} icon="add" onPress={() => void doImport()} />
        {message ? <Text variant="footnote" secondary>{message}</Text> : null}
      </Screen>
    </>
  );
}
