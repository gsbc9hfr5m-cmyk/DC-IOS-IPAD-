/**
 * 위젯 / Live Activity 연결 (spec 2-11).
 * 기본 빌드에는 네이티브 확장이 없다. 그때는 아무것도 하지 않는다 (requireOptionalNativeModule → null).
 */
import { ExtensionStorage } from '@bacons/apple-targets';
import Constants from 'expo-constants';
import { requireOptionalNativeModule } from 'expo';

import type { RunSummary } from '@/engine/types';
import { strings } from '@/strings';

type LiveActivityNative = {
  isSupported(): boolean;
  start(presetName: string, done: number, total: number, remaining: number, status: string): Promise<string | null>;
  update(done: number, total: number, remaining: number, status: string): Promise<void>;
  end(done: number, total: number, status: string): Promise<void>;
};

const live = requireOptionalNativeModule<LiveActivityNative>('LiveActivity');
const enabled = (Constants.expoConfig?.extra as { appleTargets?: boolean } | undefined)?.appleTargets === true;
const appGroup = (Constants.expoConfig?.extra as { appGroup?: string } | undefined)?.appGroup;
const storage = enabled && appGroup ? new ExtensionStorage(appGroup) : null;

let activeActivityRun: string | null = null;
let lastPushed = '';

export function widgetsAvailable(): boolean {
  return enabled;
}

function statusText(run: RunSummary, current: string | null): string {
  if (run.status === 'paused' && run.haltReason?.includes('캡챠')) return '캡챠 필요';
  if (current?.includes('대기')) return '요청 한도 대기';
  return strings.run.status[run.status];
}

/** 홈 화면 위젯: 최근 실행 결과 */
export function updateLastRunWidget(last: RunSummary | null): void {
  if (!storage || !last) return;
  try {
    storage.set('lastDeleted', last.counts.deleted);
    storage.set('lastRunAt', new Date(last.finishedAt ?? last.updatedAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }));
    storage.set('lastStatus', strings.run.status[last.status]);
    ExtensionStorage.reloadWidget('LastRunWidget');
  } catch {
    // 위젯 갱신 실패는 무시
  }
}

/** Live Activity: 진행 중인 실행을 시작/갱신/종료한다 */
export function syncLiveActivity(run: RunSummary | null, current: string | null, engineRunning: boolean): void {
  if (!live) return;
  try {
    if (!run || run.status === 'completed' || run.status === 'cancelled') {
      if (activeActivityRun) {
        const done = run ? run.total - run.counts.pending : 0;
        void live.end(done, run?.total ?? 0, run ? strings.run.status[run.status] : '');
        activeActivityRun = null;
      }
      return;
    }
    const done = run.total - run.counts.pending;
    const status = engineRunning ? statusText(run, current) : statusText({ ...run, status: run.status === 'running' ? 'paused' : run.status }, current);
    const key = `${run.id}:${done}:${status}`;
    if (key === lastPushed) return;
    lastPushed = key;
    if (activeActivityRun !== run.id) {
      if (!live.isSupported()) return;
      activeActivityRun = run.id;
      void live.start(run.presetName, done, run.total, run.counts.pending, status);
    } else {
      void live.update(done, run.total, run.counts.pending, status);
    }
  } catch {
    // Live Activity 실패는 삭제 작업에 영향을 주지 않는다
  }
}
