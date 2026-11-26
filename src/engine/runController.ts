/**
 * 앱 전역 실행 제어. 화면(홈, 미리보기), 백그라운드 작업, 단축어가 모두 여기를 거친다.
 * 실행 시작 경로가 달라도 같은 계획 계산(computePlan)과 같은 엔진(RunEngine)을 쓴다.
 */
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { create } from 'zustand';

import { startPersistentMode, stopPersistentMode } from '@/background/persistentMode';
import * as repos from '@/db/repos';
import { syncLiveActivity, updateLastRunWidget } from '@/native/widgets';
import { notifyNow } from '@/notify/notify';
import type { Plan } from '@/presets/filter';
import type { Preset } from '@/presets/types';
import { dc, ensureSession } from '@/services/session';
import { getSettings } from '@/settings/settingsStore';
import { timestampForFile } from '@/util/files';

import { openBackupWriter } from './backup';
import { RunEngine } from './RunEngine';
import { activeRun, lastFinishedRun, recordBackup, sqliteRunStore } from './runRepo';
import type { RunOptions, RunStatus, RunSummary, RunTarget, RunTrigger } from './types';

type RunUiState = {
  active: RunSummary | null;
  last: RunSummary | null;
  current: string | null;
  engineRunning: boolean;
};

export const useRun = create<RunUiState>()(() => ({ active: null, last: null, current: null, engineRunning: false }));

const KEEP_AWAKE_TAG = 'dccleaner-run';

function refresh(current?: string | null) {
  useRun.setState((s) => ({
    active: activeRun(),
    last: lastFinishedRun(),
    current: current === undefined ? s.current : current,
    engineRunning: engine.running !== null,
  }));
  // 위젯 / Live Activity (위젯 빌드에서만 실제로 동작)
  const st = useRun.getState();
  syncLiveActivity(st.active, st.current, st.engineRunning);
  updateLastRunWidget(st.last);
}

/** 알림 종류별 설정 반영 */
function notify(title: string, body: string) {
  const st = getSettings();
  const isDone = title.includes('완료');
  if (isDone ? st.notifyDone : st.notifyProblems) notifyNow(title, body);
}

const writers = new Map<string, ReturnType<typeof openBackupWriter>>();

export const engine = new RunEngine({
  store: sqliteRunStore,
  client: dc,
  isProtected: repos.isProtected,
  ensureSession: () => ensureSession(),
  openWriter: (runId, opts) => {
    const run = sqliteRunStore.getRun(runId);
    if (!run?.backupDir) return null;
    const folder = decodeURIComponent(run.backupDir.replace(/\/$/, '').split('/').pop() ?? runId);
    const w = openBackupWriter(folder, opts.backupFormat, `DC 클리너 백업 · ${run.presetName}`);
    writers.set(runId, w);
    return w;
  },
  notify,
  onDeleted: (key) => repos.removeCachedItem(key),
  onChange: (_runId, current) => refresh(current),
});

function toRunTarget(t: Plan['targets'][number]): RunTarget {
  return {
    key: t.key,
    kind: t.kind,
    title: t.title,
    writtenAt: t.writtenAt,
    galleryId: t.galleryId,
    gallery: t.gallery,
    needsMetrics: t.needsMetrics,
    replyCount: t.replyCount,
    gallog: t.source.type === 'gallog' ? t.source.item : undefined,
    guestbook: t.source.type === 'guestbook' ? t.source.item : undefined,
  };
}

function runOptions(preset: Preset): RunOptions {
  const s = getSettings();
  return {
    presetConfig: preset.config,
    backupEnabled: s.backupEnabled,
    backupRequired: s.backupEnabled && s.backupRequired,
    backupFormat: s.backupFormat,
    failLimit: s.failLimit,
    strictVerify: s.strictVerify,
    concurrency: s.concurrency,
  };
}

/** 요청 간격 설정을 리미터에 반영 */
export function applyRequestDelay() {
  const sec = getSettings().requestDelaySec;
  dc.limiter.configure({ minIntervalMs: sec * 1000, jitterMs: Math.round(sec * 750) });
}

/**
 * 계획으로 새 실행을 만든다. 확인(Dry-run 확인 또는 스케줄 사전 확인)은 호출하는 쪽의 책임이다.
 * 이미 진행 중이거나 멈춘 실행이 있으면 만들지 않는다.
 */
export function createRun(preset: Preset, plan: Plan, trigger: RunTrigger): string | null {
  if (activeRun()) return null;
  if (plan.targets.length === 0) return null;
  const options = runOptions(preset);
  let backupDir: string | null = null;
  if (options.backupEnabled) {
    const w = openBackupWriter(`${timestampForFile()}-${preset.name.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 30)}`, options.backupFormat, `DC 클리너 백업 · ${preset.name}`);
    backupDir = w.dir;
  }
  const id = sqliteRunStore.createRun({
    presetId: preset.id,
    presetName: preset.name,
    trigger,
    options,
    targets: plan.targets.map(toRunTarget),
    backupDir,
  });
  refresh(null);
  return id;
}

/** 실행(또는 재개). foreground면 화면 꺼짐을 막는다. */
export async function runNow(runId: string, opts: { deadline?: number; foreground?: boolean } = {}): Promise<RunStatus> {
  if (engine.running) return 'running';
  applyRequestDelay();
  if (opts.foreground) {
    await activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    await startPersistentMode();
  }
  try {
    const status = await engine.run(runId, { deadline: opts.deadline });
    return status;
  } finally {
    if (opts.foreground) {
      deactivateKeepAwake(KEEP_AWAKE_TAG);
      stopPersistentMode();
    }
    const w = writers.get(runId);
    const run = sqliteRunStore.getRun(runId);
    if (w && run?.backupDir) recordBackup(runId, run.backupDir, getSettings().backupFormat, w.count(), w.bytes());
    writers.delete(runId);
    refresh(null);
  }
}

export function pauseRun() {
  engine.requestPause();
}

export function cancelRun(runId: string) {
  if (engine.running === runId) engine.requestCancel();
  else {
    sqliteRunStore.setStatus(runId, 'cancelled');
    refresh(null);
  }
}

/** 앱 시작 시: 상태를 읽고, 직전에 'running'이던 실행은 이어서 진행한다 (이미 확인을 받은 실행) */
export function initRunState() {
  refresh(null);
  const a = activeRun();
  if (a?.status === 'running' && !engine.running) void runNow(a.id, { foreground: true });
}

export { refresh as refreshRunState };
