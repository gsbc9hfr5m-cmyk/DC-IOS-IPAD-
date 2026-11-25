import * as Haptics from 'expo-haptics';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import {
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutRectangle,
} from 'react-native';

// components.tsx와 서로 import하지만, 렌더 시점에만 사용하므로 순환 참조 문제가 없다.
import { Text } from '@/ui/components';
import { GlassSurface } from '@/ui/glass';
import { Icon } from '@/ui/icons';
import { strings } from '@/strings';

import { helpTexts, type HelpId } from './helpTexts';

// 한 번에 하나만 열리도록 앱 전체에서 상태를 공유한다.
type OpenState = { id: HelpId; anchor: LayoutRectangle } | null;
const HelpContext = createContext<{ open: (id: HelpId, anchor: LayoutRectangle) => void } | null>(null);

const POPOVER_WIDTH = 300;
const MARGIN = 16;

export function HelpProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OpenState>(null);
  const close = useCallback(() => setState(null), []);
  const open = useCallback((id: HelpId, anchor: LayoutRectangle) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setState({ id, anchor }); // 기존에 열린 팝오버는 교체된다
  }, []);
  const value = useMemo(() => ({ open }), [open]);

  return (
    <HelpContext.Provider value={value}>
      {children}
      <HelpPopover state={state} onClose={close} />
    </HelpContext.Provider>
  );
}

function HelpPopover({ state, onClose }: { state: OpenState; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const [cardHeight, setCardHeight] = useState(0);

  // 아무 방향으로나 스와이프하면 닫힌다
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 12 || Math.abs(g.dy) > 12,
        onPanResponderRelease: (_, g) => {
          if (Math.abs(g.dx) > 40 || Math.abs(g.dy) > 40) onClose();
        },
      }),
    [onClose],
  );

  if (!state) return null;
  const text = helpTexts[state.id];
  const cardWidth = Math.min(POPOVER_WIDTH, width - MARGIN * 2);
  const left = Math.max(MARGIN, Math.min(state.anchor.x + state.anchor.width / 2 - cardWidth / 2, width - cardWidth - MARGIN));
  const below = state.anchor.y + state.anchor.height + 8;
  const top = below + cardHeight + MARGIN > height ? Math.max(MARGIN, state.anchor.y - cardHeight - 8) : below;

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={strings.common.close} {...pan.panHandlers}>
        <View
          style={[styles.card, { width: cardWidth, left, top }]}
          onLayout={(e) => setCardHeight(e.nativeEvent.layout.height)}
          accessibilityViewIsModal>
          <GlassSurface radius={20} style={styles.inner}>
            <Text variant="headline">{text.title}</Text>
            <Text variant="callout">{text.what}</Text>
            <Text variant="callout" secondary>
              {text.effect}
            </Text>
            {'caution' in text && text.caution ? (
              <View style={styles.caution}>
                <Icon name="warning" size={15} color={'risk' in text && text.risk ? 'tint' : 'secondary'} />
                <Text variant="footnote" secondary style={styles.flex}>
                  {text.caution}
                </Text>
              </View>
            ) : null}
          </GlassSurface>
        </View>
      </Pressable>
    </Modal>
  );
}

/** 라벨 옆 (!) 아이콘. 터치 영역 44pt, VoiceOver 라벨 "도움말". */
export function HelpBadge({ id }: { id: HelpId }) {
  const ctx = useContext(HelpContext);
  const ref = useRef<ComponentRef<typeof View>>(null);
  const text = helpTexts[id];
  const risky = 'risk' in text && text.risk === true;

  return (
    <Pressable
      ref={ref}
      hitSlop={0}
      style={styles.badge}
      accessibilityRole="button"
      accessibilityLabel={strings.common.help}
      accessibilityHint={text.title}
      onPress={() => {
        ref.current?.measureInWindow((x, y, w, h) => ctx?.open(id, { x, y, width: w, height: h }));
      }}>
      <Icon name="help" size={17} color={risky ? 'tint' : 'secondary'} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  card: { position: 'absolute' },
  inner: { padding: 16, gap: 8 },
  caution: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  flex: { flex: 1 },
});
