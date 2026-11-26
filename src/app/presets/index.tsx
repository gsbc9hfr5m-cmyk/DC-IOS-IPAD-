import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActionSheetIOS, Alert, Pressable, StyleSheet, View } from 'react-native';

import { deletePreset, duplicatePreset, listPresets } from '@/db/repos';
import { describePreset } from '@/presets/filter';
import type { Preset } from '@/presets/types';
import { strings } from '@/strings';
import { colors } from '@/ui/colors';
import { GlassButton, GlassCard, LabelWithHelp, Text } from '@/ui/components';
import { Icon } from '@/ui/icons';
import { Screen } from '@/ui/Screen';

const s = strings.presets;

export default function PresetsScreen() {
  const router = useRouter();
  const [presets, setPresets] = useState<Preset[]>([]);
  const reload = useCallback(() => setPresets(listPresets()), []);
  useFocusEffect(reload);

  const openActions = (p: Preset) => {
    const options = [s.preview, s.edit, s.duplicate, s.remove, strings.common.cancel];
    ActionSheetIOS.showActionSheetWithOptions(
      { title: p.name, options, destructiveButtonIndex: 3, cancelButtonIndex: 4 },
      (i) => {
        if (i === 0) router.push({ pathname: '/presets/preview', params: { id: p.id } });
        if (i === 1) router.push({ pathname: '/presets/edit', params: { id: p.id } });
        if (i === 2) {
          duplicatePreset(p.id);
          reload();
        }
        if (i === 3) {
          Alert.alert(s.removeConfirm(p.name), undefined, [
            { text: strings.common.cancel, style: 'cancel' },
            {
              text: s.remove,
              style: 'destructive',
              onPress: () => {
                deletePreset(p.id);
                reload();
              },
            },
          ]);
        }
      },
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: s.title }} />
      <Screen>
        {presets.length === 0 ? (
          <GlassCard style={styles.empty}>
            <Icon name="tabPresets" size={34} color="secondary" />
            <LabelWithHelp label={s.empty} help="presets" />
          </GlassCard>
        ) : (
          presets.map((p) => (
            <Pressable key={p.id} onPress={() => openActions(p)} accessibilityRole="button" accessibilityLabel={p.name}>
              {({ pressed }) => (
                <GlassCard style={{ opacity: pressed ? 0.75 : 1 }}>
                  <View style={styles.row}>
                    <Text variant="headline" style={styles.flex} numberOfLines={1}>
                      {p.name}
                    </Text>
                    {p.schedule?.enabled ? (
                      <Text variant="caption" style={{ color: colors.tint }}>
                        {s.scheduleBadge}
                      </Text>
                    ) : null}
                    <Icon name="chevron" size={14} color="secondary" />
                  </View>
                  <Text variant="footnote" secondary>
                    {describePreset(p.config)}
                  </Text>
                </GlassCard>
              )}
            </Pressable>
          ))
        )}
        <GlassButton label={s.add} icon="add" help="presets" onPress={() => router.push('/presets/edit')} />
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', paddingVertical: 32, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
});
