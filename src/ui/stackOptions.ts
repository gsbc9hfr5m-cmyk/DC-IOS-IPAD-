import type { NativeStackNavigationOptions } from 'expo-router';

import { liquidGlassSupported } from './glass';

/**
 * 탭 안 Stack 공통 헤더.
 * - iOS 26+: 투명 헤더 → 시스템이 리퀴드 글래스 내비게이션 바로 그린다.
 * - iOS 26 미만: 시스템 머티리얼 블러 헤더로 대체한다.
 */
export const largeTitleStack: NativeStackNavigationOptions = {
  headerLargeTitle: true,
  headerTransparent: true,
  headerShadowVisible: false,
  headerLargeTitleShadowVisible: false,
  ...(liquidGlassSupported ? {} : { headerBlurEffect: 'systemMaterial' as const }),
};
