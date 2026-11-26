/**
 * 스케줄 계산 (spec 2-9). 순수 함수 (기기 현지 시각 기준).
 * iOS BackgroundTask는 정확한 시각을 보장하지 않으므로 "예정 시각이 지났고 그 이후 아직 실행하지 않았으면 실행" 방식이다.
 */
import type { Schedule } from '@/presets/types';

function parseTime(time: string): { h: number; m: number } | null {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  return h < 24 && mm < 60 ? { h, m: mm } : null;
}

const dayAllowed = (s: Schedule, weekday: number) => s.weekdays.length === 0 || s.weekdays.includes(weekday);

/** now 이전(포함)의 가장 최근 예정 시각. 최근 8일 안에 없으면 null */
export function lastOccurrence(s: Schedule, now: Date): Date | null {
  const t = parseTime(s.time);
  if (!s.enabled || !t) return null;
  for (let back = 0; back <= 7; back++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, t.h, t.m, 0, 0);
    if (d.getTime() <= now.getTime() && dayAllowed(s, d.getDay())) return d;
  }
  return null;
}

/** now 이후의 다음 예정 시각 */
export function nextOccurrence(s: Schedule, now: Date): Date | null {
  const t = parseTime(s.time);
  if (!s.enabled || !t) return null;
  for (let fwd = 0; fwd <= 7; fwd++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + fwd, t.h, t.m, 0, 0);
    if (d.getTime() > now.getTime() && dayAllowed(s, d.getDay())) return d;
  }
  return null;
}

/**
 * 실행할 차례인가: 가장 최근 예정 시각이 지났고, 그 이후 실행 기록이 없다.
 * createdAt 이전의 예정 시각은 세지 않는다 (프리셋을 만들자마자 과거 일정으로 실행되지 않도록).
 */
export function isDue(s: Schedule, lastRunAt: string | null, now: Date, createdAt?: string): boolean {
  const occ = lastOccurrence(s, now);
  if (!occ) return false;
  if (createdAt && occ.getTime() < Date.parse(createdAt)) return false;
  return !lastRunAt || Date.parse(lastRunAt) < occ.getTime();
}

/** 놓친 스케줄: 실행할 차례인데 예정 시각에서 graceMs 이상 지났다 (앱 실행 시 "지금 실행할까요?") */
export function isMissed(s: Schedule, lastRunAt: string | null, now: Date, createdAt?: string, graceMs = 2 * 3_600_000): boolean {
  if (!isDue(s, lastRunAt, now, createdAt)) return false;
  const occ = lastOccurrence(s, now)!;
  return now.getTime() - occ.getTime() >= graceMs;
}

export function describeSchedule(s: Schedule, names: readonly string[]): string {
  const days = s.weekdays.length === 0 || s.weekdays.length === 7 ? '매일' : s.weekdays.map((d) => names[d]).join('·');
  return `${days} ${s.time} 이후`;
}
