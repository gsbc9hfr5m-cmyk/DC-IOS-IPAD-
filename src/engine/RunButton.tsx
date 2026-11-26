import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { Alert } from 'react-native';

import type { Plan } from '@/presets/filter';
import type { Preset } from '@/presets/types';
import { requireReauth } from '@/security/auth';
import { getSettings } from '@/settings/settingsStore';
import { strings } from '@/strings';
import { GlassButton, Text } from '@/ui/components';

import { createRun, runNow, useRun } from './runController';

const p = strings.preview;

/** Dry-run 확인 후 삭제 시작. 되돌릴 수 없으므로 항상 확인 대화상자를 거친다 (spec 2-3). */
export function RunButton({ preset, plan }: { preset: Preset; plan: Plan }) {
  const router = useRouter();
  const active = useRun((s) => s.active);
  const n = plan.targets.length;

  const start = async () => {
    if (!(await requireReauth('runStart'))) return;
    const id = createRun(preset, plan, 'manual');
    if (!id) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    router.navigate('/');
    void runNow(id, { foreground: true });
  };

  const confirm = () =>
    Alert.alert(p.runConfirmTitle, p.runConfirmBody(n, getSettings().backupEnabled), [
      { text: strings.common.cancel, style: 'cancel' },
      { text: p.runConfirmOk, style: 'destructive', onPress: () => void start() },
    ]);

  if (active) {
    return (
      <Text variant="footnote" secondary>
        {strings.run.alreadyActive}
      </Text>
    );
  }
  return <GlassButton label={p.run(n)} icon="trash" help="runCleaner" prominent disabled={n === 0} onPress={confirm} />;
}
