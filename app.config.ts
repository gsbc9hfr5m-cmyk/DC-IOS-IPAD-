/**
 * app.json 위에 조건부 설정을 얹는다.
 *
 * 위젯 / Live Activity (spec 2-11)는 네이티브 확장이라 로컬(Windows)에서 빌드해 볼 수 없다.
 * 기본 IPA가 깨지지 않도록 DC_APPLE_TARGETS=1 일 때만 넣는다 (GitHub Actions의 별도 잡에서 사용).
 */
import type { ConfigContext, ExpoConfig } from 'expo/config';

export const APP_GROUP = 'group.io.github.gsbc9hfr5m.dccleaner';

export default ({ config }: ConfigContext): ExpoConfig => {
  const base = config as ExpoConfig;
  if (process.env.DC_APPLE_TARGETS !== '1') return base;
  return {
    ...base,
    ios: {
      ...base.ios,
      entitlements: { ...base.ios?.entitlements, 'com.apple.security.application-groups': [APP_GROUP] },
      infoPlist: { ...base.ios?.infoPlist, NSSupportsLiveActivities: true },
    },
    plugins: [...(base.plugins ?? []), '@bacons/apple-targets'],
    extra: { ...base.extra, appleTargets: true, appGroup: APP_GROUP },
  };
};
