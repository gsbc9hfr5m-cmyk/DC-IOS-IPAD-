import type { ReactNode } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { colors } from './colors';

/** 탭 화면 공통 스크롤 컨테이너. 대형 제목/글래스 내비바 아래로 자동 인셋. */
export function Screen({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      style={styles.root}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 20, paddingBottom: 48 },
});
