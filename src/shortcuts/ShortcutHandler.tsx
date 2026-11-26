import { useEffect } from 'react';
import { Alert } from 'react-native';

import { pauseRun, refreshRunState, runNow, useRun } from '@/engine/runController';
import { activeRun } from '@/engine/runRepo';
import { requireReauth } from '@/security/auth';
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
