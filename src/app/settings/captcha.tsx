import * as Haptics from 'expo-haptics';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import { createSolver, SOLVERS, SolverError, type SolverId } from '@/captcha/solvers';
import { loadCaptchaKey, maskKeyForDisplay, saveCaptchaKey } from '@/secure/secrets';
import { useSettings } from '@/settings/settingsStore';
import { strings } from '@/strings';
import { colors } from '@/ui/colors';
import { GlassButton, ListRow, Section, Text, TextField } from '@/ui/components';
import { Icon } from '@/ui/icons';
import { Screen } from '@/ui/Screen';

const s = strings.captcha;
const SOLVER_IDS = Object.keys(SOLVERS) as SolverId[];

export default function CaptchaSettingsScreen() {
  const mode = useSettings((st) => st.captchaMode);
  const solver = useSettings((st) => st.captchaSolver);
  const set = useSettings((st) => st.set);
  const [storedKey, setStoredKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadCaptchaKey(solver).then((k) => alive && setStoredKey(k));
    return () => {
      alive = false;
    };
  }, [solver]);

  const choose = (patch: Parameters<typeof set>[0]) => {
    void Haptics.selectionAsync();
    if (patch.captchaSolver && patch.captchaSolver !== solver) {
      // 서비스를 바꾸면 입력 중이던 키와 테스트 결과를 비운다
      setDraft('');
      setMessage(null);
      setStoredKey(null);
    }
    set(patch);
  };

  const save = async () => {
    await saveCaptchaKey(solver, draft);
    setStoredKey(draft.trim() || null);
    setDraft('');
    setMessage({ ok: true, text: s.saved });
  };

  const test = async () => {
    const key = draft.trim() || storedKey;
    if (!key) return;
    setTesting(true);
    setMessage(null);
    try {
      const balance = await createSolver(solver, key).getBalance();
      setMessage({ ok: balance > 0, text: s.balance(balance) });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof SolverError ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  const check = (on: boolean) => (on ? <Icon name="check" color="tint" size={18} /> : null);

  return (
    <>
      <Stack.Screen options={{ title: s.title, headerLargeTitle: false }} />
      <Screen>
        <Section title={s.modeSection}>
          <ListRow label={s.manual} help="captchaMode" right={check(mode === 'manual')} onPress={() => choose({ captchaMode: 'manual' })} />
          <ListRow label={s.auto} help="captchaAuto" right={check(mode === 'auto')} onPress={() => choose({ captchaMode: 'auto' })} last />
        </Section>

        {mode === 'auto' ? (
          <>
            <Section title={s.serviceSection} footer={s.autoFooter}>
              {SOLVER_IDS.map((id, i) => (
                <ListRow
                  key={id}
                  label={SOLVERS[id].name}
                  right={check(solver === id)}
                  onPress={() => choose({ captchaSolver: id })}
                  last={i === SOLVER_IDS.length - 1}
                />
              ))}
            </Section>

            <Section title={s.keySection}>
              <ListRow icon="key" label={s.currentKey(SOLVERS[solver].name)} help="captchaApiKey" value={maskKeyForDisplay(storedKey)} />
              <TextField label={s.newKey} value={draft} onChangeText={setDraft} placeholder={s.keyPlaceholder} secureTextEntry last />
            </Section>
            <GlassButton label={s.save} icon="check" onPress={() => void save()} disabled={!draft.trim()} />
            <GlassButton
              label={testing ? s.testing : s.test}
              icon="captcha"
              help="captchaKeyTest"
              onPress={() => void test()}
              disabled={testing || (!draft.trim() && !storedKey)}
            />
            {message ? (
              <Text variant="footnote" style={[styles.msg, { color: message.ok ? colors.secondaryLabel : colors.destructive }]}>
                {message.text}
              </Text>
            ) : null}
          </>
        ) : null}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  msg: { paddingHorizontal: 16 },
});
