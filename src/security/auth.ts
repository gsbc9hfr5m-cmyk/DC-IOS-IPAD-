/**
 * 생체 인증 (spec 2-10). Face ID / Touch ID, 실패하면 기기 암호로 폴백.
 */
import * as LocalAuthentication from 'expo-local-authentication';

import { getSettings } from '@/settings/settingsStore';

export type SensitiveAction = 'runStart' | 'backupDelete' | 'accountView';

const PROMPTS: Record<SensitiveAction | 'unlock', string> = {
  unlock: 'DC 클리너 잠금 해제',
  runStart: '삭제를 시작하려면 인증하세요',
  backupDelete: '백업을 삭제하려면 인증하세요',
  accountView: '계정 정보를 보려면 인증하세요',
};

/** 기기에서 인증을 쓸 수 있는가 (생체 또는 기기 암호) */
export async function authAvailable(): Promise<boolean> {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    return level !== LocalAuthentication.SecurityLevel.NONE;
  } catch {
    return false;
  }
}

export async function authenticate(reason: SensitiveAction | 'unlock'): Promise<boolean> {
  try {
    const r = await LocalAuthentication.authenticateAsync({
      promptMessage: PROMPTS[reason],
      cancelLabel: '취소',
      // false: 생체 인증 실패 시 기기 암호 입력으로 넘어갈 수 있다
      disableDeviceFallback: false,
    });
    return r.success;
  } catch {
    return false;
  }
}

/** 중요 동작 재인증 옵션이 켜져 있으면 인증을 요구한다. 꺼져 있거나 기기에 암호가 없으면 통과. */
export async function requireReauth(action: SensitiveAction): Promise<boolean> {
  if (!getSettings().reauthSensitive) return true;
  if (!(await authAvailable())) return true;
  return authenticate(action);
}
