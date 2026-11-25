/**
 * 비밀이 아닌 설정값. expo-sqlite kv-store에 영속화한다 (설정 내보내기 대상, 9단계).
 * 비밀값(비밀번호, API 키)은 src/secure/secrets.ts.
 */
import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { SolverId } from '@/captcha/solvers';

export type Settings = {
  captchaMode: 'manual' | 'auto';
  captchaSolver: SolverId;
  /** 로그인 정보를 키체인에 저장해 세션 만료 시 자동 재로그인 */
  rememberLogin: boolean;
};

type SettingsState = Settings & {
  set: (patch: Partial<Settings>) => void;
};

export const DEFAULT_SETTINGS: Settings = {
  captchaMode: 'manual',
  captchaSolver: '2captcha',
  rememberLogin: true,
};

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
    },
  ),
);

/** React 밖(엔진, 서비스)에서 현재 값 읽기 */
export const getSettings = (): Settings => useSettings.getState();
