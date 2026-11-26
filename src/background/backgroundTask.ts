/**
 * 백그라운드 이어달리기 (spec 2-8-1).
 * iOS가 허락할 때마다(대략 15분 이상 간격, 주로 충전 중/밤) 깨어나서
 * 진행 중인 삭제가 있으면 시간이 허락하는 만큼 처리하고 체크포인트를 남긴다.
 * 이 모듈은 앱 진입 시 바로 import되어야 한다 (TaskManager.defineTask는 전역 범위에서 호출).
 */
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { runNow } from '@/engine/runController';
import { activeRun } from '@/engine/runRepo';

export const BG_TASK = 'dccleaner.background';

/** iOS 백그라운드 작업 한 번에 쓸 수 있는 시간은 짧다. 여유를 두고 끊는다. */
const SLICE_MS = 25_000;

TaskManager.defineTask(BG_TASK, async () => {
  try {
    const deadline = Date.now() + SLICE_MS;
    const run = activeRun();
    // paused/halted는 사용자가 확인해야 하므로 건드리지 않는다
    if (run?.status === 'running') await runNow(run.id, { deadline });
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundTask(): Promise<boolean> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return false;
    if (!(await TaskManager.isTaskRegisteredAsync(BG_TASK))) {
      await BackgroundTask.registerTaskAsync(BG_TASK, { minimumInterval: 15 });
    }
    return true;
  } catch {
    return false;
  }
}
