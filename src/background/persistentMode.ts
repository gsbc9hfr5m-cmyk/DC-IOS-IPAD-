/**
 * 지속 실행 모드 (사이드로드 전용, spec 2-8-3).
 * 무음 오디오를 반복 재생해 앱이 백그라운드에서도 계속 실행되게 한다. 기본값 OFF.
 * ⚠️ 배터리를 많이 쓰고 App Store 심사를 통과할 수 없는 방식이다. 설정 화면에 경고를 표시한다.
 * 다른 앱의 소리를 끊지 않도록 mixWithOthers로 재생한다.
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

import { getSettings } from '@/settings/settingsStore';

let player: AudioPlayer | null = null;

export async function startPersistentMode(): Promise<void> {
  if (!getSettings().persistentMode || player) return;
  try {
    await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'mixWithOthers' });
    player = createAudioPlayer(require('../../assets/audio/silence.wav'));
    player.loop = true;
    player.volume = 0;
    player.play();
  } catch {
    player = null;
  }
}

export function stopPersistentMode(): void {
  try {
    player?.pause();
    player?.remove();
  } catch {
    // 이미 해제됨
  }
  player = null;
}
