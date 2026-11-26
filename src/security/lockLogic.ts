/** 백그라운드에서 돌아왔을 때 다시 잠가야 하는가 (spec 2-10: 즉시/1분/5분) */
export function shouldLockOnReturn(lockDelaySec: number, backgroundedAt: number | null, now: number): boolean {
  if (backgroundedAt === null) return false;
  return now - backgroundedAt >= lockDelaySec * 1000;
}
