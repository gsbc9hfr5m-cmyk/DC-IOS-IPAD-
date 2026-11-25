import { NativeTabs } from 'expo-router/native-tabs';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { HelpProvider } from '@/help/HelpBadge';
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
  return (
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
        </OnboardingGate>
      </HelpProvider>
    </ThemeProvider>
  );
}
