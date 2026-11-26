import * as Clipboard from 'expo-clipboard';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { listPresets } from '@/db/repos';
import type { Preset } from '@/presets/types';
import { shortcutUrl } from '@/shortcuts/shortcutUrl';
import { strings } from '@/strings';
import { GlassCard, LabelWithHelp, ListRow, Section, Text } from '@/ui/components';
import { Screen } from '@/ui/Screen';

const t = strings.shortcuts;

/** 단축어용 URL 목록. 행을 누르면 주소가 복사된다. */
export default function ShortcutsScreen() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  useFocusEffect(useCallback(() => setPresets(listPresets()), []));

  const copy = (url: string) => {
    void Clipboard.setStringAsync(url);
    setCopied(url);
  };

  const row = (label: string, url: string, last = false) => (
    <ListRow key={url} label={label} value={copied === url ? t.copied : url} onPress={() => copy(url)} last={last} />
  );

  return (
    <>
      <Stack.Screen options={{ title: t.title, headerLargeTitle: false }} />
      <Screen>
        <GlassCard>
          <LabelWithHelp label={t.title} help="shortcuts" variant="headline" />
          <Text secondary>{t.intro}</Text>
          <Text variant="footnote" secondary>
            {t.note}
          </Text>
        </GlassCard>
        <Section title={t.run}>
          {presets.length ? presets.map((p, i) => row(p.name, shortcutUrl({ action: 'run', preset: p.id }), i === presets.length - 1)) : <Text secondary>{strings.presets.empty}</Text>}
        </Section>
        <Section>
          {row(t.pause, shortcutUrl({ action: 'pause' }))}
          {row(t.resume, shortcutUrl({ action: 'resume' }))}
          {row(t.status, shortcutUrl({ action: 'status' }), true)}
        </Section>
      </Screen>
    </>
  );
}
