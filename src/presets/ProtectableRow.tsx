import * as Haptics from 'expo-haptics';
import { useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';

import { strings } from '@/strings';
import { colors } from '@/ui/colors';
import { Text } from '@/ui/components';
import { Icon } from '@/ui/icons';

import type { Target } from './filter';

const KIND_LABEL = { post: '글', comment: '댓글', guestbook: '방명록' } as const;

/** Dry-run 목록 한 줄. 길게 누르거나 왼쪽으로 밀면 보호/해제 (spec 2-4). */
export function ProtectableRow({ target, isProtected, onToggle }: { target: Target; isProtected: boolean; onToggle: (t: Target) => void }) {
  const ref = useRef<SwipeableMethods>(null);
  const toggle = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onToggle(target);
    ref.current?.close();
  };
  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={2}
      rightThreshold={48}
      renderRightActions={() => (
        <Pressable onPress={toggle} style={styles.action} accessibilityRole="button">
          <Icon name="shield" color="tint" />
          <Text variant="caption" style={{ color: colors.tint }}>
            {isProtected ? strings.preview.unprotect : strings.preview.protect}
          </Text>
        </Pressable>
      )}>
      <Pressable
        onLongPress={toggle}
        delayLongPress={350}
        accessibilityHint={strings.preview.longPressHint}
        accessibilityActions={[{ name: 'activate', label: isProtected ? strings.preview.unprotect : strings.preview.protect }]}
        onAccessibilityAction={toggle}
        style={styles.row}>
        <View style={styles.flex}>
          <Text numberOfLines={2}>{target.title || '(제목 없음)'}</Text>
          <Text variant="caption" secondary numberOfLines={1}>
            {[KIND_LABEL[target.kind], target.galleryId, target.writtenAt.slice(0, 10), target.replyCount ? strings.preview.replies(target.replyCount) : null]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        {isProtected ? (
          <View style={styles.badge}>
            <Icon name="shield" size={13} color="tint" />
            <Text variant="caption" style={{ color: colors.tint }}>
              {strings.preview.protectedBadge}
            </Text>
          </View>
        ) : null}
      </Pressable>
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 56,
    backgroundColor: colors.secondaryBackground,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  flex: { flex: 1, gap: 2 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  action: { width: 88, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: colors.background },
});
