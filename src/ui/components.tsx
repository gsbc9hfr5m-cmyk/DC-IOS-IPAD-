import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Switch,
  Text as RNText,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type ViewStyle,
} from 'react-native';

import { HelpBadge } from '@/help/HelpBadge';
import type { HelpId } from '@/help/helpTexts';

import { colors } from './colors';
import { GlassSurface } from './glass';
import { Icon, type IconName } from './icons';

type Variant = 'largeTitle' | 'title' | 'headline' | 'body' | 'callout' | 'footnote' | 'caption';

const typo = StyleSheet.create({
  largeTitle: { fontSize: 34, fontWeight: '700' },
  title: { fontSize: 22, fontWeight: '700' },
  headline: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 17 },
  callout: { fontSize: 16 },
  footnote: { fontSize: 13 },
  caption: { fontSize: 12 },
});

export function Text({
  variant = 'body',
  secondary = false,
  style,
  ...rest
}: TextProps & { variant?: Variant; secondary?: boolean }) {
  return (
    <RNText
      {...rest}
      style={[typo[variant], { color: secondary ? colors.secondaryLabel : colors.label }, style]}
    />
  );
}

/** 리퀴드 글래스 카드 */
export function GlassCard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <GlassSurface style={[styles.card, style]}>{children}</GlassSurface>;
}

/** 라벨 + (!) 도움말 한 줄 */
export function LabelWithHelp({ label, help, variant = 'body' }: { label: string; help?: HelpId; variant?: Variant }) {
  return (
    <View style={styles.labelRow}>
      <Text variant={variant} style={styles.flexShrink}>
        {label}
      </Text>
      {help ? <HelpBadge id={help} /> : null}
    </View>
  );
}

type ButtonProps = {
  label: string;
  icon?: IconName;
  help?: HelpId;
  onPress?: () => void;
  disabled?: boolean;
  prominent?: boolean;
};

/** 글래스 버튼. 누를 때 가벼운 햅틱. */
export function GlassButton({ label, icon, help, onPress, disabled, prominent }: ButtonProps) {
  return (
    <View style={styles.buttonWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress?.();
        }}
        style={({ pressed }) => [styles.flex, { opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }]}>
        <GlassSurface interactive tinted={prominent} radius={999} style={styles.button}>
          {icon ? <Icon name={icon} color={prominent ? 'primary' : 'tint'} /> : null}
          <Text variant="headline" style={prominent ? undefined : { color: colors.tint }}>
            {label}
          </Text>
        </GlassSurface>
      </Pressable>
      {help ? <HelpBadge id={help} /> : null}
    </View>
  );
}

type RowProps = {
  label: string;
  icon?: IconName;
  help?: HelpId;
  value?: string;
  right?: ReactNode;
  onPress?: () => void;
  last?: boolean;
};

/** 설정 목록 행 (글래스 카드 안에서 사용) */
export function ListRow({ label, icon, help, value, right, onPress, last }: RowProps) {
  const content = (
    <View style={[styles.row, !last && styles.rowDivider]}>
      {icon ? <Icon name={icon} color="secondary" /> : null}
      <View style={styles.rowLabel}>
        <LabelWithHelp label={label} help={help} />
      </View>
      {value ? (
        <Text secondary numberOfLines={1} style={styles.rowValue}>
          {value}
        </Text>
      ) : null}
      {right}
      {onPress ? <Icon name="chevron" size={14} color="secondary" /> : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      {content}
    </Pressable>
  );
}

/** 스위치 한 줄 */
export function SwitchRow({
  label,
  help,
  value,
  onChange,
  disabled,
  last,
}: {
  label: string;
  help?: HelpId;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  last?: boolean;
}) {
  return (
    <ListRow
      label={label}
      help={help}
      last={last}
      right={
        <Switch
          value={value}
          disabled={disabled}
          onValueChange={(v) => {
            void Haptics.selectionAsync();
            onChange(v);
          }}
        />
      }
    />
  );
}

/** 선택형 한 줄 (선택되면 체크 표시) */
export function OptionRow({ label, help, selected, onPress, last }: { label: string; help?: HelpId; selected: boolean; onPress: () => void; last?: boolean }) {
  return (
    <ListRow
      label={label}
      help={help}
      last={last}
      right={selected ? <Icon name="check" color="tint" size={18} /> : <View style={styles.checkSpace} />}
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
    />
  );
}

/** 작은 선택 칩 (요일, 갤러리 ID 등) */
export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      style={[styles.chip, { borderColor: selected ? colors.tint : colors.separator }]}>
      <Text variant="callout" style={{ color: selected ? colors.tint : colors.label }}>
        {label}
      </Text>
    </Pressable>
  );
}

type FieldProps =Omit<TextInputProps, 'style'> & { label: string; help?: HelpId; last?: boolean };

/** 글래스 카드 안의 입력 행 */
export function TextField({ label, help, last, ...input }: FieldProps) {
  return (
    <View style={[styles.field, !last && styles.rowDivider]}>
      <View style={styles.fieldLabel}>
        <LabelWithHelp label={label} help={help} variant="callout" />
      </View>
      <TextInput
        placeholderTextColor={colors.tertiaryLabel}
        autoCapitalize="none"
        autoCorrect={false}
        {...input}
        style={styles.fieldInput}
      />
    </View>
  );
}

export function Section({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      {title ? (
        <Text variant="footnote" secondary style={styles.sectionTitle}>
          {title}
        </Text>
      ) : null}
      <GlassCard style={styles.sectionCard}>{children}</GlassCard>
      {footer ? (
        <Text variant="footnote" secondary style={styles.sectionFooter}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  card: { padding: 16, gap: 8 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 1 },
  buttonWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  button: {
    minHeight: 50,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  row: { minHeight: 48, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  rowLabel: { flex: 1 },
  rowValue: { maxWidth: '45%' },
  field: { minHeight: 52, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 },
  fieldLabel: { width: 96 },
  fieldInput: { flex: 1, fontSize: 17, color: colors.label, paddingVertical: 12 },
  checkSpace: { width: 18 },
  chip: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  section: { gap: 6 },
  sectionTitle: { paddingHorizontal: 16, textTransform: 'uppercase' },
  sectionCard: { padding: 0, gap: 0 },
  sectionFooter: { paddingHorizontal: 16 },
});
