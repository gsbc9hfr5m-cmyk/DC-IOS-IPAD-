/**
 * 앱 전역 디시 세션 (spec 2-1).
 * - 앱 시작 시 쿠키로 세션 복원
 * - 로그인: 캡챠가 나오면 CaptchaService로 풀고 다시 시도 (최대 3회)
 * - 세션 만료 시 저장된 자격증명으로 자동 재로그인 (ensureSession). 실패하면 알림.
 */
import { create } from 'zustand';

import { askManualCaptcha } from '@/captcha/captchaPrompt';
import { CaptchaService } from '@/captcha/CaptchaService';
import { createSolver } from '@/captcha/solvers';
import { DC_HOSTS } from '@/dc/config';
import { DcClient, type Credentials, type LoginResult } from '@/dc/DcClient';
import { DcError, isDcError } from '@/dc/errors';
import { fetchImageBase64 } from '@/dc/http';
import { notifyNow } from '@/notify/notify';
import { clearDcCredentials, loadCaptchaKey, loadDcCredentials, saveDcCredentials } from '@/secure/secrets';
import { getSettings } from '@/settings/settingsStore';

export const dc = new DcClient();

export const captcha = new CaptchaService({
  getMode: () => getSettings().captchaMode,
  getSolverId: () => getSettings().captchaSolver,
  getApiKey: loadCaptchaKey,
  createSolver: (id, key) => createSolver(id, key),
  fetchImageBase64,
  askManual: askManualCaptcha,
  notify: notifyNow,
});

type SessionStatus = 'unknown' | 'checking' | 'loggedOut' | 'loggedIn';

type SessionState = {
  status: SessionStatus;
  uid: string | null;
  lastError: string | null;
};

export const useSession = create<SessionState>()(() => ({ status: 'unknown', uid: null, lastError: null }));

const setSession = (patch: Partial<SessionState>) => useSession.setState(patch);

function absoluteSignUrl(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  return `${DC_HOSTS.sign}${url.startsWith('/') ? '' : '/'}${url}`;
}

export type LoginOutcome =
  | { ok: true; uid: string }
  | { ok: false; reason: 'captchaCancelled' | 'otp' | 'failed' | 'error'; message: string };

/** 캡챠를 포함한 로그인. 성공하면 rememberLogin 설정에 따라 키체인에 저장한다. */
export async function login(creds: Credentials, opts: { remember: boolean }): Promise<LoginOutcome> {
  setSession({ status: 'checking', lastError: null });
  try {
    let result: LoginResult = await dc.login(creds);
    for (let attempt = 0; result.status === 'captcha' && attempt < 3; attempt++) {
      const solved = await captcha.solve(
        { context: 'login', imageUrl: absoluteSignUrl(result.imageUrl), randCode: result.randCode },
        // 자동 풀이 답이 틀렸으면 다음은 수동으로
        { forceManual: result.wrongCode && attempt > 0 },
      );
      if (!solved) return finish({ ok: false, reason: 'captchaCancelled', message: '캡챠 입력을 취소했습니다.' });
      result = await dc.login(creds, solved.answer);
    }
    switch (result.status) {
      case 'ok':
        if (opts.remember) await saveDcCredentials(creds);
        return finish({ ok: true, uid: result.uid });
      case 'otp':
        return finish({ ok: false, reason: 'otp', message: '2차 인증(OTP)을 쓰는 계정은 아직 지원하지 않습니다.' });
      case 'captcha':
        return finish({ ok: false, reason: 'failed', message: '캡챠를 여러 번 통과하지 못했습니다. 잠시 후 다시 시도하세요.' });
      case 'failed':
        return finish({ ok: false, reason: 'failed', message: result.message });
    }
  } catch (e) {
    return finish({ ok: false, reason: 'error', message: isDcError(e) ? e.message : '로그인 중 오류가 발생했습니다.' });
  }
}

function finish(o: LoginOutcome): LoginOutcome {
  if (o.ok) setSession({ status: 'loggedIn', uid: o.uid, lastError: null });
  else setSession({ status: 'loggedOut', uid: null, lastError: o.message });
  return o;
}

/** 앱 시작/복귀 시: 쿠키 세션 확인 → 없으면 저장된 자격증명으로 재로그인 시도 */
export async function restoreSession(): Promise<void> {
  setSession({ status: 'checking' });
  try {
    const uid = await dc.restoreSession();
    if (uid) {
      setSession({ status: 'loggedIn', uid, lastError: null });
      return;
    }
    await ensureSession({ silent: true });
  } catch (e) {
    setSession({ status: 'loggedOut', uid: null, lastError: isDcError(e) ? e.message : '세션 확인에 실패했습니다.' });
  }
}

/**
 * 엔진이 sessionExpired를 받았을 때 호출한다. 성공하면 uid, 실패하면 DcError(sessionExpired).
 * silent: 앱 시작 시 저장된 자격증명이 없을 때 조용히 로그아웃 상태로 둔다.
 */
export async function ensureSession(opts: { silent?: boolean } = {}): Promise<string> {
  const existing = dc.currentUid ?? (await dc.restoreSession());
  if (existing) {
    setSession({ status: 'loggedIn', uid: existing });
    return existing;
  }
  const creds = getSettings().rememberLogin ? await loadDcCredentials() : null;
  if (!creds) {
    setSession({ status: 'loggedOut', uid: null });
    if (!opts.silent) notifyNow('로그인이 필요합니다', '디시 로그인이 만료되었습니다. 앱에서 다시 로그인해 주세요.');
    throw new DcError('sessionExpired', '로그인이 필요합니다.');
  }
  const o = await login(creds, { remember: true });
  if (o.ok) return o.uid;
  if (!opts.silent) notifyNow('자동 재로그인 실패', o.message);
  throw new DcError('sessionExpired', o.message);
}

export async function logout(opts: { forgetCredentials: boolean }): Promise<void> {
  try {
    await dc.logout();
  } catch {
    // 네트워크가 안 돼도 로컬 상태는 정리한다
  }
  if (opts.forgetCredentials) await clearDcCredentials();
  setSession({ status: 'loggedOut', uid: null, lastError: null });
}
