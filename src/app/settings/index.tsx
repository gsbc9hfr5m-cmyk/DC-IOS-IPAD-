import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import { StyleSheet, Switch, View } from 'react-native';

import { strings } from '@/strings';
import { GlassCard, LabelWithHelp, ListRow, Section, Text } from '@/ui/components';
import { Icon } from '@/ui/icons';
import { Screen } from '@/ui/Screen';

const s = strings.settings;

/**
 * 설정 화면 골격. 각 항목의 실제 동작은 해당 단계에서 연결한다.
 * 모든 항목에 (!) 도움말이 붙어 있어야 한다 (spec 2-17).
 */
export default function SettingsScreen() {
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
          <ListRow icon="account" label={s.account} help="account" value={s.notLoggedIn} last />
        </Section>

        <Section title={s.sections.captcha}>
          <ListRow icon="captcha" label={s.captchaMode} help="captchaMode" value="수동" />
          <ListRow label={s.captchaApiKey} help="captchaApiKey" value="없음" last />
        </Section>

        <Section title={s.sections.background}>
          <ListRow icon="background" label={s.persistentMode} help="persistentMode" right={<Switch value={false} disabled />} />
          <ListRow label={s.backgroundLimits} help="backgroundLimits" last />
        </Section>

        <Section title={s.sections.safety}>
          <ListRow icon="speed" label={s.requestDelay} help="requestDelay" value="4~7초" />
          <ListRow label={s.concurrency} help="concurrency" value="1" />
          <ListRow label={s.autoPause} help="autoPause" value="연속 5회 실패" last />
        </Section>

        <Section title={s.sections.protect}>
          <ListRow icon="shield" label={s.protectList} help="protectList" last />
        </Section>

        <Section title={s.sections.lock}>
          <ListRow icon="lock" label={s.appLock} help="appLock" right={<Switch value={false} disabled />} />
          <ListRow label={s.reauth} help="reauthSensitive" right={<Switch value={false} disabled />} last />
        </Section>

        <Section title={s.sections.notify}>
          <ListRow icon="bell" label={s.notifications} last />
        </Section>

        <Section title={s.sections.backup}>
          <ListRow icon="backup" label={s.backupBeforeDelete} help="backupBeforeDelete" right={<Switch value disabled />} />
          <ListRow label={s.settingsBackup} help="settingsBackup" last />
        </Section>

        <Section title={s.sections.debug}>
          <ListRow icon="debug" label={s.debugMode} help="debugMode" right={<Switch value={false} disabled />} last />
        </Section>

        <Section title={s.sections.about} footer={strings.common.comingSoon}>
          <ListRow icon="info" label={s.version} value={Constants.expoConfig?.version ?? '-'} last />
        </Section>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 4 },
  warnRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
});
