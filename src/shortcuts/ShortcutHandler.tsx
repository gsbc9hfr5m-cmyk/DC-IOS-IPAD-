import { useEffect } from 'react';
import { Alert } from 'react-native';

import { getPreset, listPresets } from '@/db/repos';
import { createRun, pauseRun, refreshRunState, runNow, useRun } from '@/engine/runController';
import { activeRun } from '@/engine/runRepo';
import { computePlan } from '@/presets/usePlan';
import { requireReauth } from '@/security/auth';
import { ensureSession } from '@/services/session';
import { strings } from '@/strings';

import { takeShortcut, useShortcutQueue } from './shortcutStore';
import type { ShortcutAction } from './shortcutUrl';

const t = strings.shortcuts;

async function handle(a: ShortcutAction) {
  switch (a.action) {
    case 'pause':
      pauseRun();
      return;
    case 'resume': {
      const run = activeRun();
      if (run && (await requireReauth('runStart'))) void runNow(run.id, { foreground: true });
      return;
    }
    case 'status': {
      refreshRunState(null);
      const run = useRun.getState().active ?? useRun.getState().last;
      if (!run) return Alert.alert(t.statusTitle, strings.home.statusIdleDetail);
      const c = run.counts;
      return Alert.alert(
        t.statusTitle,
        `${run.presetName} · ${strings.run.status[run.status]}\n${strings.run.counts(c.deleted, c.failed, c.skipped, c.protected, c.unverified)}${c.pending ? `\n${strings.run.remaining(c.pending, Math.ceil((c.pending * 11) / 60))}` : ''}`,
      );
    }
    case 'run': {
      // 프리셋은 ID 또는 이름으로 찾는다
      const preset = getPreset(a.preset) ?? listPresets().find((p) => p.name === a.preset) ?? null;
      if (!preset) return Alert.alert(t.unknownPreset);
      if (activeRun()) return Alert.alert(t.busy);
      try {
        await ensureSession();
      } catch (e) {
        return Alert.alert(e instanceof Error ? e.message : String(e));
      }
      const plan = computePlan(preset);
      if (!plan.targets.length) return Alert.alert(t.noTargets);
      // 단축어로 들어와도 반드시 앱 안에서 확인을 받는다 (Dry-run 요약 포함)
      Alert.alert(t.confirmTitle, t.confirmBody(preset.name, plan.targets.length), [
        { text: strings.common.cancel, style: 'cancel' },
        {
          text: t.confirmOk,
          style: 'destructive',
          onPress: async () => {
            if (!(await requireReauth('runStart'))) return;
            const id = createRun(preset, plan, 'shortcut');
            if (id) void runNow(id, { foreground: true });
          },
        },
      ]);
    }
  }
}

/** 대기 중인 단축어 동작을 처리한다. 루트 레이아웃에 한 번 둔다. */
export function ShortcutHandler() {
  const pending = useShortcutQueue((s) => s.pending);
  useEffect(() => {
    if (!pending) return;
    const a = takeShortcut();
    // 잠금 화면이 먼저 뜰 수 있도록 살짝 늦춘다
    if (a) setTimeout(() => void handle(a), 600);
  }, [pending]);
  return null;
}
