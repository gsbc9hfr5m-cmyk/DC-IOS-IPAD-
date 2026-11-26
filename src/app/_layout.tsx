import { NativeTabs } from 'expo-router/native-tabs';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import type { SFSymbol } from 'sf-symbols-typescript';

// 백그라운드 작업 정의는 앱 진입 시 바로 실행되어야 한다
import { registerBackgroundTask } from '@/background/backgroundTask';
import { CaptchaSheet } from '@/captcha/CaptchaSheet';
import { initRunState } from '@/engine/runController';
import { syncScheduleNotifications } from '@/schedule/scheduler';
import { AppLockGate } from '@/security/AppLockGate';
import { HelpProvider } from '@/help/HelpBadge';
import { restoreSession } from '@/services/session';
import { OnboardingGate } from '@/onboarding/OnboardingGate';
import { strings } from '@/strings';
import { colors } from '@/ui/colors';
import { ICONS } from '@/ui/icons';

/**
 * 탭바: NativeTabs (UITabBarController).
 * iOS 26 이상에서는 시스템이 리퀴드 글래스로 그리고, 그 미만에서는 시스템 반투명 블러 탭바가 된다.
 * 아이콘 규칙: 선택 상태도 윤곽선 그대로 쓰고 색으로만 구분한다 (default와 selected에 같은 이름).
 */
function tabIcon(name: SFSymbol) {
  return { default: name, selected: name } as const;
}

export default function RootLayout() {
  const scheme = useColorScheme();
  useEffect(() => {
    // 앱 시작 시 쿠키 세션 확인 → 없으면 저장된 자격증명으로 조용히 재로그인
    void restoreSession();
    initRunState();
    void registerBackgroundTask();
    void syncScheduleNotifications();
  }, []);
  return (
    <GestureHandlerRootView style={StyleSheet.absoluteFill}>
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <HelpProvider>
        <OnboardingGate>
          <NativeTabs tintColor={colors.tint} minimizeBehavior="onScrollDown">
            <NativeTabs.Trigger name="(home)">
              <NativeTabs.Trigger.Label>{strings.tabs.home}</NativeTabs.Trigger.Label>
              <NativeTabs.Trigger.Icon sf={tabIcon(ICONS.tabHome)} />
            </NativeTabs.Trigger>
            <NativeTabs.Trigger name="presets">
              <NativeTabs.Trigger.Label>{strings.tabs.presets}</NativeTabs.Trigger.Label>
              <NativeTabs.Trigger.Icon sf={tabIcon(ICONS.tabPresets)} />
            </NativeTabs.Trigger>
            <NativeTabs.Trigger name="history">
              <NativeTabs.Trigger.Label>{strings.tabs.history}</NativeTabs.Trigger.Label>
              <NativeTabs.Trigger.Icon sf={tabIcon(ICONS.tabHistory)} />
            </NativeTabs.Trigger>
            <NativeTabs.Trigger name="settings">
              <NativeTabs.Trigger.Label>{strings.tabs.settings}</NativeTabs.Trigger.Label>
              <NativeTabs.Trigger.Icon sf={tabIcon(ICONS.tabSettings)} />
            </NativeTabs.Trigger>
          </NativeTabs>
          <CaptchaSheet />
        </OnboardingGate>
        <AppLockGate />
      </HelpProvider>
    </ThemeProvider>
    </GestureHandlerRootView>
  );
}
