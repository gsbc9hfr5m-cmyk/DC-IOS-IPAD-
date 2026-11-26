/**
 * 스케줄 실행 (spec 2-9) + 예고 알림.
 * - 프리셋을 저장할 때 예정 시각에 로컬 알림을 예약한다 (예고).
 * - 백그라운드 작업이나 앱 실행 시 실행할 차례인 스케줄을 찾는다.
 * - 스케줄 실행에도 백업과 보호 목록이 똑같이 적용된다 (같은 계획 계산과 같은 엔진).
 * - 스케줄은 생성/변경 시 명시적으로 확인받은 것(scheduleConfirmedAt)만 실행한다.
 */
import * as Notifications from 'expo-notifications';

import { collectRecent } from '@/collect/collector';
import * as repos from '@/db/repos';
import { nowIso } from '@/db/db';
import { createRun } from '@/engine/runController';
import { activeRun } from '@/engine/runRepo';
import { notifyNow } from '@/notify/notify';
import { computePlan } from '@/presets/usePlan';
import type { Preset } from '@/presets/types';
import { dc, ensureSession } from '@/services/session';
import { getSettings } from '@/settings/settingsStore';

import { isDue, isMissed } from './schedule';

const NOTI_PREFIX = 'schedule:';

const lastRunKey = (id: string) => `schedule.lastRun.${id}`;

export function scheduleLastRun(presetId: string): string | null {
  return repos.getMeta(lastRunKey(presetId));
}

export function markScheduleHandled(presetId: string): void {
  repos.setMeta(lastRunKey(presetId), nowIso());
}

/** 확인을 받은 스케줄 프리셋만 */
function schedulablePresets(): Preset[] {
  return repos.listPresets().filter((p) => p.schedule?.enabled && p.scheduleConfirmedAt);
}

export function duePresets(now = new Date()): Preset[] {
  return schedulablePresets().filter((p) => isDue(p.schedule!, scheduleLastRun(p.id), now, p.scheduleConfirmedAt!));
}

export function missedPresets(now = new Date()): Preset[] {
  return schedulablePresets().filter((p) => isMissed(p.schedule!, scheduleLastRun(p.id), now, p.scheduleConfirmedAt!));
}

/**
 * 실행할 차례인 스케줄 하나로 새 실행을 만든다. 최근 글을 빠르게 다시 수집한 뒤 계획을 계산한다.
 * 다른 실행이 진행 중이면 만들지 않는다. 반환: 만든 runId 또는 null
 */
export async function startScheduledRun(preset: Preset, trigger: 'schedule' | 'shortcut' = 'schedule'): Promise<string | null> {
  if (activeRun()) return null;
  await ensureSession();
  const k = preset.config.kinds;
  if (k.post) await collectRecent('post', { client: dc, sink: repos });
  if (k.comment) await collectRecent('comment', { client: dc, sink: repos });
  const plan = computePlan(preset);
  markScheduleHandled(preset.id);
  if (plan.targets.length === 0) return null;
  const id = createRun(preset, plan, trigger);
  if (id && trigger === 'schedule' && getSettings().notifySchedule) {
    notifyNow('예약 삭제를 시작합니다', `${preset.name}: ${plan.targets.length}개 (백업·보호 목록 적용)`);
  }
  return id;
}

/** 예고 알림을 프리셋 스케줄에 맞춰 다시 예약한다 */
export async function syncScheduleNotifications(): Promise<void> {
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      all.filter((n) => n.identifier.startsWith(NOTI_PREFIX)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
    );
    if (!getSettings().notifySchedule) return;
    for (const p of schedulablePresets()) {
      const [h, m] = p.schedule!.time.split(':').map(Number) as [number, number];
      const days = p.schedule!.weekdays.length ? p.schedule!.weekdays : [0, 1, 2, 3, 4, 5, 6];
      for (const d of days) {
        await Notifications.scheduleNotificationAsync({
          identifier: `${NOTI_PREFIX}${p.id}:${d}`,
          content: {
            title: '예약 삭제 예정',
            body: `"${p.name}" 스케줄이 이 시각 이후 가능한 때에 실행됩니다. 앱을 열면 지금 실행할지 물어봅니다.`,
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: d + 1, hour: h, minute: m },
        });
      }
    }
  } catch {
    // 알림 권한이 없으면 예고만 생략된다
  }
}
