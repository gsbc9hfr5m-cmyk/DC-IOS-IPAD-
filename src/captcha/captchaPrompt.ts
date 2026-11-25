/**
 * 수동 캡챠 입력 요청 큐. CaptchaService.askManual → 시트(CaptchaSheet)가 표시 → 사용자가 입력/취소.
 * 한 번에 하나만 표시한다. 이미 떠 있으면 앞선 요청을 취소한다.
 */
import { create } from 'zustand';

import type { ManualRequest } from './CaptchaService';

export type Pending = ManualRequest & { id: number; resolve: (code: string | null) => void };

type State = {
  pending: Pending | null;
  submit: (code: string | null) => void;
};

let seq = 0;

export const useCaptchaPrompt = create<State>()((set, get) => ({
  pending: null,
  submit: (code) => {
    const p = get().pending;
    set({ pending: null });
    p?.resolve(code);
  },
}));

export function askManualCaptcha(req: ManualRequest): Promise<string | null> {
  return new Promise((resolve) => {
    const prev = useCaptchaPrompt.getState().pending;
    prev?.resolve(null);
    useCaptchaPrompt.setState({ pending: { ...req, id: ++seq, resolve } });
  });
}
