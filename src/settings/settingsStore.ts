/**
 * 비밀이 아닌 설정값. expo-sqlite kv-store에 영속화한다 (설정 백업/복원 대상, spec 2-15).
 * 비밀값(비밀번호, API 키, 세션)은 src/secure/secrets.ts — 여기에 절대 넣지 않는다.
 */
import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { SolverId } from '@/captcha/solvers';

export type Settings = {
  // 계정 / 캡챠
  captchaMode: 'manual' | 'auto';
  captchaSolver: SolverId;
  rememberLogin: boolean;
  // 백업 (2-5)
  backupEnabled: boolean;
  backupRequired: boolean;
  backupFormat: 'json' | 'html';
  // 지연 / 안전 (2-6, 2-7)
  requestDelaySec: number;
  concurrency: number;
  failLimit: number;
  /** 매 삭제마다 실제로 사라졌는지 다시 확인 (느리지만 가장 안전) */
  strictVerify: boolean;
  // 백그라운드 (2-8)
  persistentMode: boolean;
  // 앱 잠금 (2-10)
  appLock: boolean;
  lockDelaySec: 0 | 60 | 300;
  reauthSensitive: boolean;
  // 알림 (2-8-4)
  notifyDone: boolean;
  notifyProblems: boolean;
  notifySchedule: boolean;
  // 디버그 (2-16)
  debugMode: boolean;
};

type SettingsState = Settings & {
  set: (patch: Partial<Settings>) => void;
};

export const DEFAULT_SETTINGS: Settings = {
  captchaMode: 'manual',
  captchaSolver: '2captcha',
  rememberLogin: true,
  backupEnabled: true,
  backupRequired: true,
  backupFormat: 'html',
  requestDelaySec: 4,
  concurrency: 1,
  failLimit: 5,
  strictVerify: false,
  persistentMode: false,
  appLock: false,
  lockDelaySec: 0,
  reauthSensitive: false,
  notifyDone: true,
  notifyProblems: true,
  notifySchedule: true,
  debugMode: false,
};

/** 가져온 설정값을 허용 범위로 맞춘다 */
export function sanitizeSettings(raw: Partial<Record<keyof Settings, unknown>>): Partial<Settings> {
  const out: Partial<Settings> = {};
  const bool = (k: keyof Settings) => {
    if (typeof raw[k] === 'boolean') (out as Record<string, unknown>)[k] = raw[k];
  };
  (
    [
      'rememberLogin',
      'backupEnabled',
      'backupRequired',
      'strictVerify',
      'persistentMode',
      'appLock',
      'reauthSensitive',
      'notifyDone',
      'notifyProblems',
      'notifySchedule',
      'debugMode',
    ] as const
  ).forEach(bool);
  if (raw.captchaMode === 'manual' || raw.captchaMode === 'auto') out.captchaMode = raw.captchaMode;
  if (raw.captchaSolver === '2captcha' || raw.captchaSolver === 'anticaptcha' || raw.captchaSolver === 'capsolver') out.captchaSolver = raw.captchaSolver;
  if (raw.backupFormat === 'json' || raw.backupFormat === 'html') out.backupFormat = raw.backupFormat;
  const int = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined);
  out.requestDelaySec = int(raw.requestDelaySec, 3, 60) ?? out.requestDelaySec;
  out.concurrency = int(raw.concurrency, 1, 3) ?? out.concurrency;
  out.failLimit = int(raw.failLimit, 1, 50) ?? out.failLimit;
  if (raw.lockDelaySec === 0 || raw.lockDelaySec === 60 || raw.lockDelaySec === 300) out.lockDelaySec = raw.lockDelaySec;
  for (const k of Object.keys(out) as (keyof Settings)[]) if (out[k] === undefined) delete out[k];
  return out;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (patch) => set(patch),
    }),
    {
      name: 'settings.v1',
      version: 1,
      storage: createJSONStorage(() => Storage),
      partialize: ({ set: _set, ...rest }) => rest,
      merge: (persisted, current) => ({ ...current, ...sanitizeSettings((persisted ?? {}) as Partial<Record<keyof Settings, unknown>>) }),
    },
  ),
);

/** React 밖(엔진, 서비스)에서 현재 값 읽기 */
export const getSettings = (): Settings => useSettings.getState();
