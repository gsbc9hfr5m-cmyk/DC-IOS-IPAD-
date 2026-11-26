/**
 * 홈 화면 위젯 + Live Activity 확장 (spec 2-11).
 * DC_APPLE_TARGETS=1 빌드에서만 app.config.ts가 @bacons/apple-targets 플러그인을 켠다.
 * @type {import('@bacons/apple-targets/app.plugin').ConfigFunction}
 */
module.exports = (config) => ({
  type: 'widget',
  name: 'DCCleanerWidget',
  displayName: 'DC 클리너',
  deploymentTarget: '17.0',
  frameworks: ['SwiftUI', 'WidgetKit', 'ActivityKit'],
  entitlements: {
    'com.apple.security.application-groups': config.ios.entitlements['com.apple.security.application-groups'],
  },
});
