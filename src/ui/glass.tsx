import { BlurView } from 'expo-blur';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from './colors';

/**
 * 리퀴드 글래스 가용 여부 (런타임 감지).
 * - iOS 26 미만이거나 API가 없으면 false가 되고 expo-blur 반투명 블러로 대체한다.
 * - isGlassEffectAPIAvailable: 일부 iOS 26 베타에서 GlassView가 크래시하는 문제를 막는 검사
 */
export const liquidGlassSupported: boolean = (() => {
  if (Platform.OS !== 'ios') return false;
  try {
    return isGlassEffectAPIAvailable() && isLiquidGlassAvailable();
  } catch {
    return false;
  }
})();

/** "투명도 줄이기"가 켜져 있으면 글래스/블러 대신 불투명 배경을 쓴다. */
export function useReduceTransparency(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceTransparencyEnabled().then((v) => mounted && setReduce(v));
    const sub = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReduce);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

type SurfaceProps = {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  interactive?: boolean;
  /** 위험 동작 등 틴트로 물들일 때 */
  tinted?: boolean;
};

/** 글래스 → 블러 → 불투명 순으로 자동 대체되는 공통 표면 */
export function GlassSurface({ children, style, radius = 22, interactive = false, tinted = false }: SurfaceProps) {
  const reduce = useReduceTransparency();
  const shape: ViewStyle = { borderRadius: radius, borderCurve: 'continuous', overflow: 'hidden' };

  if (reduce) {
    return <View style={[shape, { backgroundColor: colors.secondaryBackground }, style]}>{children}</View>;
  }
  if (liquidGlassSupported) {
    return (
      <GlassView
        glassEffectStyle="regular"
        isInteractive={interactive}
        tintColor={tinted ? colors.tint : undefined}
        style={[shape, style]}>
        {children}
      </GlassView>
    );
  }
  return (
    <View style={[shape, style]}>
      <BlurView intensity={60} tint="systemMaterial" style={StyleSheet.absoluteFill} />
      {children}
    </View>
  );
}
