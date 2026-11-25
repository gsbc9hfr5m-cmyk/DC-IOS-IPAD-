import * as Haptics from 'expo-haptics';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, View } from 'react-native';

import { login, logout, useSession } from '@/services/session';
import { useSettings } from '@/settings/settingsStore';
import { strings } from '@/strings';
import { colors } from '@/ui/colors';
import { GlassButton, ListRow, Section, Text, TextField } from '@/ui/components';
import { Screen } from '@/ui/Screen';

const s = strings.account;

export default function AccountScreen() {
  const { status, uid, lastError } = useSession();
  const remember = useSettings((st) => st.rememberLogin);
  const setSettings = useSettings((st) => st.set);
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onLogin = async () => {
    setBusy(true);
    setError(null);
    const o = await login({ id: id.trim(), password }, { remember });
    setBusy(false);
    if (o.ok) {
      setPassword('');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      setError(o.message);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: s.title, headerLargeTitle: false }} />
      <Screen>
        {status === 'loggedIn' && uid ? (
          <>
            <Section footer={s.footer}>
              <ListRow icon="account" label={s.loggedInAs} help="account" value={uid} last />
            </Section>
            <GlassButton label={s.logout} icon="logout" onPress={() => void logout({ forgetCredentials: false })} />
            <GlassButton label={s.logoutForget} onPress={() => void logout({ forgetCredentials: true })} />
          </>
        ) : status === 'checking' && !busy ? (
          <View style={styles.center}>
            <ActivityIndicator />
            <Text secondary>{s.checking}</Text>
          </View>
        ) : (
          <>
            <Section footer={s.footer}>
              <TextField
                label={s.idLabel}
                help="account"
                value={id}
                onChangeText={setId}
                placeholder={s.idPlaceholder}
                textContentType="username"
                autoComplete="username"
              />
              <TextField
                label={s.pwLabel}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                textContentType="password"
                autoComplete="password"
                returnKeyType="go"
                onSubmitEditing={() => id && password && void onLogin()}
              />
              <ListRow
                label={s.remember}
                help="rememberLogin"
                right={<Switch value={remember} onValueChange={(v) => setSettings({ rememberLogin: v })} />}
                last
              />
            </Section>
            {error ?? lastError ? (
              <Text variant="footnote" style={styles.error}>
                {error ?? lastError}
              </Text>
            ) : null}
            <GlassButton
              label={busy ? s.loggingIn : s.login}
              icon="account"
              prominent
              disabled={busy || !id.trim() || !password}
              onPress={() => void onLogin()}
            />
          </>
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: 8, paddingVertical: 40 },
  error: { color: colors.destructive, paddingHorizontal: 16 },
});
