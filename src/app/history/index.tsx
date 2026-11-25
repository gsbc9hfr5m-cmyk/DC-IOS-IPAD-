import { Stack } from 'expo-router';

import { strings } from '@/strings';
import { ListRow, Section } from '@/ui/components';
import { Screen } from '@/ui/Screen';

/** 기록: 삭제 이력 / 백업 / 통계 (9단계에서 구현) */
export default function HistoryScreen() {
  return (
    <>
      <Stack.Screen options={{ title: strings.history.title }} />
      <Screen>
        <Section footer={strings.common.comingSoon}>
          <ListRow icon="doc" label={strings.history.deletions} />
          <ListRow icon="archive" label={strings.history.backups} help="backupBeforeDelete" />
          <ListRow icon="chart" label={strings.history.stats} last />
        </Section>
      </Screen>
    </>
  );
}
