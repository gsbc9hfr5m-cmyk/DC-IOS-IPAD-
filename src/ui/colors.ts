import { PlatformColor, type ColorValue } from 'react-native';

/**
 * Apple HIG 시스템 색만 쓴다. 다크/라이트는 시스템이 자동 처리한다.
 * 아이콘 색은 label / secondaryLabel / tint 세 가지만 허용한다 (spec-addenda B).
 */
export const colors = {
  label: PlatformColor('label'),
  secondaryLabel: PlatformColor('secondaryLabel'),
  tertiaryLabel: PlatformColor('tertiaryLabel'),
  tint: PlatformColor('systemBlue'),
  destructive: PlatformColor('systemRed'),
  separator: PlatformColor('separator'),
  background: PlatformColor('systemGroupedBackground'),
  secondaryBackground: PlatformColor('secondarySystemGroupedBackground'),
} as const satisfies Record<string, ColorValue>;

export type IconColor = 'primary' | 'secondary' | 'tint';

export const iconColor: Record<IconColor, ColorValue> = {
  primary: colors.label,
  secondary: colors.secondaryLabel,
  tint: colors.tint,
};
