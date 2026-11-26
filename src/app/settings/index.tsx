import Constants from 'expo-constants';
import { Stack, useRouter } from 'expo-router';
import { ActionSheetIOS, Alert, StyleSheet, View } from 'react-native';

import { SOLVERS } from '@/captcha/solvers';
import { ensureNotificationPermission } from '@/notify/notify';
import { authAvailable, authenticate, requireReauth } from '@/security/auth';
import { useSession } from '@/services/session';
import { useSettings, type Settings } from '@/settings/settingsStore';
import { strings } from '@/strings';
import { GlassCard, LabelWithHelp, ListRow, Section, SwitchRow, Text } from '@/ui/components';
import { Icon } from '@/ui/icons';
import { Screen } from '@/ui/Screen';

const s = strings.settings;

function pick<T extends string | number>(title: string, options: readonly T[], label: (v: T) => string, onPick: (v: T) => void) {
  ActionSheetIOS.showActionSheetWithOptions(
    { title, options: [...options.map(label), strings.common.cancel], cancelButtonIndex: options.length },
    (i) => {
      if (i < options.length) onPick(options[i]!);
    },
  );
}

/** 설정 (spec 3-4). 모든 항목에 (!) 도움말이 붙어 있다 (spec 2-17). */
export default function SettingsScreen() {
  const router = useRouter();
  const session = useSession();
  const st = useSettings();
  const set = (patch: Partial<Settings>) => st.set(patch);

  const togglePersistent = (v: boolean) => {
    if (!v) return set({ persistentMode: false });
    Alert.alert(s.persistentWarnTitle, s.persistentWarnBody, [
      { text: strings.common.cancel, style: 'cancel' },
      { text: s.persistentWarnOk, style: 'destructive', onPress: () => set({ persistentMode: true }) },
    ]);
  };

  const toggleBackup = (v: boolean) => {
    if (v) return set({ backupEnabled: true });
    Alert.alert(s.backupOffTitle, s.backupOffBody, [
      { text: strings.common.cancel, style: 'cancel' },
      { text: s.backupOffOk, style: 'destructive', onPress: () => set({ backupEnabled: false }) },
    ]);
  };

  const toggleLock = async (v: boolean) => {
    if (!v) {
      // 끌 때도 본인 확인을 받는다
      if (await authenticate('unlock')) set({ appLock: false });
      return;
    }
    if (!(await authAvailable())) return Alert.alert(strings.lock.unavailable);
    if (await authenticate('unlock')) set({ appLock: true });
  };

  const toggleNotify = async (patch: Partial<Settings>) => {
    if (Object.values(patch).some(Boolean)) await ensureNotificationPermission();
    set(patch);
  };

  const openAccount = async () => {
    if (await requireReauth('accountView')) router.push('/settings/account');
  };

  return (
    <>
      <Stack.Screen options={{ title: s.title }} />
      <Screen>
        <GlassCard>
          <View style={styles.warnRow}>
            <Icon name="warning" color="tint" />
            <View style={styles.flex}>
              <LabelWithHelp label={s.blockWarningTitle} help="blockWarning" variant="headline" />
              <Text variant="footnote" secondary>
                {s.blockWarning}
              </Text>
            </View>
          </View>
        </GlassCard>

        <Section title={s.sections.account}>
          <ListRow
            icon="account"
            label={s.account}
            help="account"
            value={session.status === 'loggedIn' && session.uid ? session.uid : session.status === 'checking' ? strings.account.checking : s.notLoggedIn}
            onPress={() => void openAccount()}
            last
          />
        </Section>

        <Section title={s.sections.captcha}>
          <ListRow
            icon="captcha"
            label={s.captchaMode}
            help="captchaMode"
            value={st.captchaMode === 'auto' ? strings.captcha.modeAutoShort(SOLVERS[st.captchaSolver].name) : strings.captcha.modeManualShort}
            onPress={() => router.push('/settings/captcha')}
            last
          />
        </Section>

        <Section title={s.sections.background}>
          <SwitchRow label={s.persistentMode} help="persistentMode" value={st.persistentMode} onChange={togglePersistent} />
          <ListRow icon="background" label={s.backgroundLimits} help="backgroundLimits" onPress={() => Alert.alert(s.bgLimitsTitle, s.bgLimitsBody)} last />
        </Section>

        <Section title={s.sections.safety}>
          <ListRow
            icon="speed"
            label={s.requestDelay}
            help="requestDelay"
            value={s.seconds(st.requestDelaySec)}
            onPress={() => pick(s.requestDelay, [4, 6, 10, 20] as const, s.seconds, (v) => set({ requestDelaySec: v }))}
          />
          <ListRow
            label={s.concurrency}
            help="concurrency"
            value={String(st.concurrency)}
            onPress={() => pick(s.concurrency, [1, 2, 3] as const, String, (v) => set({ concurrency: v }))}
          />
          <ListRow
            label={s.autoPause}
            help="autoPause"
            value={s.times(st.failLimit)}
            onPress={() => pick(s.autoPause, [3, 5, 10] as const, s.times, (v) => set({ failLimit: v }))}
          />
          <SwitchRow label={s.strictVerify} help="strictVerify" value={st.strictVerify} onChange={(strictVerify) => set({ strictVerify })} last />
        </Section>

        <Section title={s.sections.protect}>
          <ListRow icon="shield" label={s.protectList} help="protectList" onPress={() => router.push('/settings/protected')} last />
        </Section>

        <Section title={s.sections.lock}>
          <SwitchRow label={s.appLock} help="appLock" value={st.appLock} onChange={(v) => void toggleLock(v)} />
          <ListRow
            label={s.lockDelay}
            help="lockDelay"
            value={strings.lock.delay[st.lockDelaySec]}
            onPress={() => pick(s.lockDelay, [0, 60, 300] as const, (v) => strings.lock.delay[v], (v) => set({ lockDelaySec: v }))}
          />
          <SwitchRow label={s.reauth} help="reauthSensitive" value={st.reauthSensitive} onChange={(reauthSensitive) => set({ reauthSensitive })} last />
        </Section>

        <Section title={s.sections.notify}>
          <SwitchRow label={s.notifyDone} help="notifications" value={st.notifyDone} onChange={(notifyDone) => void toggleNotify({ notifyDone })} />
          <SwitchRow label={s.notifyProblems} value={st.notifyProblems} onChange={(notifyProblems) => void toggleNotify({ notifyProblems })} last />
        </Section>

        <Section title={s.sections.backup}>
          <SwitchRow label={s.backupBeforeDelete} help="backupBeforeDelete" value={st.backupEnabled} onChange={toggleBackup} />
          <SwitchRow
            label={s.backupRequired}
            help="backupRequired"
            value={st.backupRequired}
            disabled={!st.backupEnabled}
            onChange={(backupRequired) => set({ backupRequired })}
          />
          <ListRow
            label={s.backupFormat}
            help="backupFormat"
            value={s.backupFormats[st.backupFormat]}
            onPress={() => pick(s.backupFormat, ['html', 'json'] as const, (v) => s.backupFormats[v], (v) => set({ backupFormat: v }))}
          />
          <ListRow icon="archive" label={s.backupList} help="backupList" onPress={() => router.push('/history/backups')} />
          <ListRow label={s.settingsBackup} help="settingsBackup" onPress={() => router.push('/settings/transfer')} last />
        </Section>

        <Section title={s.sections.debug}>
          <SwitchRow label={s.debugMode} help="debugMode" value={st.debugMode} onChange={(debugMode) => set({ debugMode })} />
          <ListRow icon="debug" label={s.debugLogs} onPress={() => router.push('/settings/debug')} last />
        </Section>

        <Section title={s.sections.about}>
          <ListRow icon="info" label={s.version} value={Constants.expoConfig?.version ?? '-'} />
          <ListRow label={strings.shortcuts.title} help="shortcuts" onPress={() => router.push('/settings/shortcuts')} last />
        </Section>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 4 },
  warnRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
});
