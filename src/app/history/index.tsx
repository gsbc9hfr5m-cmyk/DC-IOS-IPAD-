import { Stack, useRouter } from 'expo-router';

import { strings } from '@/strings';
import { ListRow, Section } from '@/ui/components';
import { Screen } from '@/ui/Screen';

/** 기록: 삭제 이력 / 백업 / 통계 */
export default function HistoryScreen() {
  const router = useRouter();
  return (
    <>
      <Stack.Screen options={{ title: strings.history.title }} />
      <Screen>
        <Section>
          <ListRow icon="doc" label={strings.history.deletions} help="history" onPress={() => router.push('/history/log')} />
          <ListRow icon="archive" label={strings.history.backups} help="backupList" onPress={() => router.push('/history/backups')} />
          <ListRow icon="chart" label={strings.history.stats} help="stats" onPress={() => router.push('/history/stats')} last />
        </Section>
      </Screen>
    </>
  );
}
