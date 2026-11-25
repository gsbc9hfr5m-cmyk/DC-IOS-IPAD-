import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, StyleSheet, TextInput, View } from 'react-native';

import { strings } from '@/strings';
import { colors } from '@/ui/colors';
import { GlassButton, LabelWithHelp, Text } from '@/ui/components';
import { GlassSurface } from '@/ui/glass';

import { useCaptchaPrompt, type Pending } from './captchaPrompt';

const s = strings.captcha;

/** 수동 캡챠 입력 시트. 이미지 코드형만 다룬다 (WebView 불필요). 루트 레이아웃에 한 번만 둔다. */
export function CaptchaSheet() {
  const pending = useCaptchaPrompt((st) => st.pending);
  const submit = useCaptchaPrompt((st) => st.submit);
  if (!pending) return null;
  // 요청마다 key를 바꿔 입력값과 이미지 상태를 새로 시작한다
  return <CaptchaSheetBody key={pending.id} pending={pending} submit={submit} />;
}

function CaptchaSheetBody({ pending, submit }: { pending: Pending; submit: (code: string | null) => void }) {
  const [code, setCode] = useState('');
  const [image, setImage] = useState<string | null>(pending.imageBase64);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, []);

  const reload = async () => {
    setReloading(true);
    try {
      setImage(await pending.reload());
      setCode('');
    } catch {
      // 새 이미지를 못 받으면 기존 이미지를 유지한다
    } finally {
      setReloading(false);
    }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="formSheet" onRequestClose={() => submit(null)}>
      <View style={styles.sheet}>
        <LabelWithHelp label={s.sheetTitle} help="captchaMode" variant="title" />
        <Text secondary>{pending.context === 'login' ? s.sheetLogin : s.sheetDelete}</Text>
        {pending.fallbackReason ? (
          <Text variant="footnote" style={{ color: colors.destructive }}>
            {s.fallback(pending.fallbackReason)}
          </Text>
        ) : null}

        <GlassSurface style={styles.imageBox}>
          {image && !reloading ? (
            <Image
              source={{ uri: `data:image/png;base64,${image}` }}
              style={styles.image}
              resizeMode="contain"
              accessibilityLabel={s.sheetTitle}
            />
          ) : (
            <ActivityIndicator />
          )}
        </GlassSurface>

        <TextInput
          value={code}
          onChangeText={setCode}
          placeholder={s.inputPlaceholder}
          placeholderTextColor={colors.tertiaryLabel}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => code.trim() && submit(code)}
          style={styles.input}
        />

        <View style={styles.row}>
          <View style={styles.flex}>
            <GlassButton label={s.reload} icon="reload" onPress={reload} disabled={reloading} />
          </View>
          <View style={styles.flex}>
            <GlassButton label={s.submit} icon="check" prominent onPress={() => submit(code)} disabled={!code.trim()} />
          </View>
        </View>
        <GlassButton label={s.cancel} onPress={() => submit(null)} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, padding: 24, gap: 14, backgroundColor: colors.background },
  imageBox: { height: 110, alignItems: 'center', justifyContent: 'center', padding: 12 },
  image: { width: '100%', height: '100%' },
  input: {
    minHeight: 52,
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 22,
    letterSpacing: 4,
    color: colors.label,
    backgroundColor: colors.secondaryBackground,
    textAlign: 'center',
  },
  row: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
});
