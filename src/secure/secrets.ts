/**
 * 비밀값은 iOS 키체인(expo-secure-store)에만 저장한다. 로그, 설정 내보내기, SQLite에는 절대 넣지 않는다.
 * AFTER_FIRST_UNLOCK: 백그라운드 작업(7단계)에서 재로그인할 수 있도록 잠금 해제 이후에는 읽을 수 있게 한다.
 * THIS_DEVICE_ONLY: 아이클라우드 키체인 동기화와 백업 복원으로 다른 기기에 옮겨지지 않는다.
 */
import * as SecureStore from 'expo-secure-store';

import type { SolverId } from '@/captcha/solvers';

const OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

const K = {
  dcId: 'dc.id',
  dcPassword: 'dc.password',
  captchaKey: (id: SolverId) => `captcha.apiKey.${id}`,
};

export type DcCredentials = { id: string; password: string };

export async function saveDcCredentials(c: DcCredentials): Promise<void> {
  await SecureStore.setItemAsync(K.dcId, c.id, OPTS);
  await SecureStore.setItemAsync(K.dcPassword, c.password, OPTS);
}

export async function loadDcCredentials(): Promise<DcCredentials | null> {
  const [id, password] = await Promise.all([SecureStore.getItemAsync(K.dcId, OPTS), SecureStore.getItemAsync(K.dcPassword, OPTS)]);
  return id && password ? { id, password } : null;
}

export async function clearDcCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(K.dcId, OPTS);
  await SecureStore.deleteItemAsync(K.dcPassword, OPTS);
}

export async function saveCaptchaKey(id: SolverId, key: string): Promise<void> {
  if (key.trim() === '') await SecureStore.deleteItemAsync(K.captchaKey(id), OPTS);
  else await SecureStore.setItemAsync(K.captchaKey(id), key.trim(), OPTS);
}

export async function loadCaptchaKey(id: SolverId): Promise<string | null> {
  return SecureStore.getItemAsync(K.captchaKey(id), OPTS);
}

/** 화면 표시용: 앞 4자리만 보여준다 */
export function maskKeyForDisplay(key: string | null): string {
  if (!key) return '없음';
  return key.length <= 4 ? '••••' : `${key.slice(0, 4)}••••`;
}
