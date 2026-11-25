import { SymbolView } from 'expo-symbols';
import type { SFSymbol } from 'sf-symbols-typescript';

import { iconColor, type IconColor } from './colors';

/**
 * 앱에서 쓰는 SF Symbol은 전부 여기서만 정의한다.
 * 규칙 (docs/spec-addenda.md B):
 *  - 윤곽선만 쓴다. 이름에 fill 세그먼트가 들어간 변형은 금지한다.
 *  - 굵기는 regular로 통일한다.
 *  - 색은 primary / secondary / tint만 쓴다.
 * `npm run check:icons`와 jest 테스트가 소스 전체에서 fill 변형을 검사한다.
 */
export const ICONS = {
  // 탭
  tabHome: 'house',
  tabPresets: 'slider.horizontal.3',
  tabHistory: 'clock.arrow.circlepath',
  tabSettings: 'gearshape',
  // 공통
  help: 'exclamationmark.circle',
  chevron: 'chevron.right',
  play: 'play.circle',
  pause: 'pause.circle',
  stop: 'stop.circle',
  add: 'plus.circle',
  trash: 'trash',
  shield: 'shield',
  archive: 'archivebox',
  chart: 'chart.bar',
  doc: 'doc.text',
  // 설정
  account: 'person.crop.circle',
  captcha: 'checkmark.shield',
  background: 'moon.zzz',
  speed: 'speedometer',
  lock: 'lock',
  bell: 'bell',
  backup: 'externaldrive',
  debug: 'ladybug',
  info: 'info.circle',
  warning: 'exclamationmark.triangle',
  reload: 'arrow.clockwise',
  check: 'checkmark',
  key: 'key',
  logout: 'rectangle.portrait.and.arrow.right',
} as const satisfies Record<string, SFSymbol>;

export type IconName = keyof typeof ICONS;

export function isOutlineSymbol(name: string): boolean {
  return !/(^|\.)fill(\.|$)/.test(name);
}

if (__DEV__) {
  for (const [key, name] of Object.entries(ICONS)) {
    if (!isOutlineSymbol(name)) {
      throw new Error(`[icons] '${key}'에 fill 변형(${name})을 쓸 수 없습니다.`);
    }
  }
}

type Props = {
  name: IconName;
  size?: number;
  color?: IconColor;
  accessibilityLabel?: string;
};

export function Icon({ name, size = 22, color = 'primary', accessibilityLabel }: Props) {
  return (
    <SymbolView
      name={ICONS[name]}
      size={size}
      weight="regular"
      type="monochrome"
      tintColor={iconColor[color]}
      accessibilityLabel={accessibilityLabel}
      accessible={accessibilityLabel !== undefined}
    />
  );
}
