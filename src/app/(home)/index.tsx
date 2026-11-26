import * as Haptics from 'expo-haptics';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { collectTargets, scannedAt, startDelete, startScan, stopScan, useActivity } from '@/activity/activityStore';
import type { DeleteKinds } from '@/activity/targets';
import { galleryGroups } from '@/db/repos';
import { RunCard } from '@/engine/RunCard';
import { refreshRunState, useRun } from '@/engine/runController';
import { isDcError } from '@/dc/errors';
import { requireReauth } from '@/security/auth';
import { useSession } from '@/services/session';
import { getSettings } from '@/settings/settingsStore';
import { strings } from '@/strings';
import { colors } from '@/ui/colors';
import { GlassButton, GlassCard, LabelWithHelp, Text } from '@/ui/components';
import { Icon } from '@/ui/icons';

const a = strings.activity;

/**
 * 메인: 로그인 → 내 글/댓글 전부 불러오기 → 갤러리별 목록 → 지울 갤러리 체크 → 글/댓글/둘 다 삭제
 */
export default function ActivityScreen() {
  const router = useRouter();
  const loggedIn = useSession((st) => st.status === 'loggedIn');
  const { scanning, progress, error, version } = useActivity();
  const active = useRun((s) => s.active);
  const runVersion = useRun((s) => s.last?.id ?? '') + (active?.counts.deleted ?? 0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useFocusEffect(useCallback(() => refreshRunState(), []));

  // eslint-disable-next-line react-hooks/exhaustive-deps -- version/runVersion이 바뀌면 DB를 다시 읽는다
  const groups = useMemo(() => (loggedIn ? galleryGroups() : []), [loggedIn, version, runVersion]);

  // 처음 로그인했으면 자동으로 불러온다
  useEffect(() => {
    if (loggedIn && !scanning && scannedAt() === null && groups.length === 0) void startScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 로그인 직후 한 번만
  }, [loggedIn]);

  const chosen = groups.filter((g) => selected.has(g.id));
  const posts = chosen.reduce((n, g) => n + g.posts, 0);
  const comments = chosen.reduce((n, g) => n + g.comments, 0);
  const allSelected = groups.length > 0 && chosen.length === groups.length;

  const toggle = (id: string) => {
    void Haptics.selectionAsync();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    void Haptics.selectionAsync();
    setSelected(allSelected ? new Set() : new Set(groups.map((g) => g.id)));
  };

  const confirmDelete = (kinds: DeleteKinds) => {
    if (active) return Alert.alert(a.busy);
    const ids = chosen.map((g) => g.id);
    const n = collectTargets(ids, kinds).length;
    if (n === 0) return Alert.alert(a.nothing);
    const where = chosen.length === 1 ? chosen[0]!.name : `${chosen[0]!.name} 외 ${chosen.length - 1}곳`;
    const what = kinds.length === 2 ? '글과 댓글' : kinds[0] === 'post' ? '글' : '댓글';
    Alert.alert(a.confirmTitle, a.confirmBody(where, what, n, getSettings().backupEnabled), [
      { text: strings.common.cancel, style: 'cancel' },
      {
        text: a.confirmOk,
        style: 'destructive',
        onPress: async () => {
          if (!(await requireReauth('runStart'))) return;
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          try {
            const id = await startDelete(ids, kinds);
            if (!id) Alert.alert(a.startFailed);
            else setSelected(new Set());
          } catch (e) {
            Alert.alert(a.startFailed, isDcError(e) ? e.message : String(e));
          }
        },
      },
    ]);
  };

  if (!loggedIn) {
    return (
      <>
        <Stack.Screen options={{ title: a.title }} />
        <ScrollView style={styles.root} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
          <GlassCard>
            <Icon name="account" size={34} color="tint" />
            <Text variant="title">{a.loginTitle}</Text>
            <Text secondary>{a.loginBody}</Text>
            <GlassButton label={a.login} icon="account" prominent onPress={() => router.push('/settings/account')} />
          </GlassCard>
        </ScrollView>
      </>
    );
  }

  const last = scannedAt();
  const busy = !!active;

  return (
    <>
      <Stack.Screen options={{ title: a.title }} />
      <ScrollView
        style={styles.root}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}>
        {/* 0: 진행 중인 삭제 */}
        <View>{active ? <RunCard run={active} /> : null}</View>

        {/* 1: 불러오기 상태 */}
        <GlassCard>
          <LabelWithHelp label={scanning ? a.load : groups.length ? a.galleries(groups.length) : a.load} help="activityScan" variant="headline" />
          {scanning && progress ? (
            <Text variant="footnote" secondary>
              {progress.waitingMs ? a.waiting(Math.ceil(progress.waitingMs / 1000)) : a.scanning(progress.kind, progress.page, progress.lastPage, progress.read, progress.total)}
            </Text>
          ) : (
            <Text variant="footnote" secondary>
              {last ? a.scannedAt(new Date(last).toLocaleString('ko-KR')) : a.neverScanned}
            </Text>
          )}
          {error ? (
            <Text variant="footnote" style={{ color: colors.destructive }}>
              {error}
            </Text>
          ) : null}
          {scanning ? (
            <GlassButton label={a.stop} icon="stop" onPress={stopScan} />
          ) : (
            <GlassButton label={last ? a.reload : a.load} icon="reload" onPress={() => void startScan()} />
          )}
        </GlassCard>

        {/* 2: 삭제 버튼 */}
        <View>
          {groups.length ? (
            <GlassCard>
              <Text variant="footnote" secondary>
                {chosen.length ? a.selected(chosen.length, posts, comments) : a.pickHint}
              </Text>
              <View style={styles.actions}>
                <View style={styles.flex}>
                  <GlassButton label={a.deletePosts(posts)} icon="trash" disabled={busy || posts === 0} onPress={() => confirmDelete(['post'])} />
                </View>
                <View style={styles.flex}>
                  <GlassButton label={a.deleteComments(comments)} icon="trash" disabled={busy || comments === 0} onPress={() => confirmDelete(['comment'])} />
                </View>
              </View>
              <GlassButton
                label={a.deleteBoth(posts + comments)}
                icon="trash"
                help="runCleaner"
                prominent
                disabled={busy || posts + comments === 0}
                onPress={() => confirmDelete(['post', 'comment'])}
              />
            </GlassCard>
          ) : null}
        </View>

        {/* 3: 갤러리 목록 */}
        {groups.length ? (
          <GlassCard style={styles.list}>
            <Row label={allSelected ? a.clearAll : a.selectAll} checked={allSelected} onPress={toggleAll} />
            {groups.map((g, i) => (
              <Row
                key={g.id}
                label={g.name}
                detail={a.counts(g.posts, g.comments)}
                checked={selected.has(g.id)}
                onPress={() => toggle(g.id)}
                last={i === groups.length - 1}
              />
            ))}
          </GlassCard>
        ) : !scanning && last ? (
          <Text secondary style={styles.center}>
            {a.empty}
          </Text>
        ) : null}
      </ScrollView>
    </>
  );
}

function Row({ label, detail, checked, onPress, last }: { label: string; detail?: string; checked: boolean; onPress: () => void; last?: boolean }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, !last && styles.divider, { opacity: pressed ? 0.6 : 1 }]}>
      <Icon name={checked ? 'checkOn' : 'checkOff'} color={checked ? 'tint' : 'secondary'} size={24} />
      <View style={styles.flex}>
        <Text numberOfLines={1}>{label}</Text>
        {detail ? (
          <Text variant="footnote" secondary>
            {detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 16, paddingBottom: 48 },
  flex: { flex: 1 },
  actions: { flexDirection: 'row', gap: 10 },
  list: { padding: 0, gap: 0 },
  row: { minHeight: 56, paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 12 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  center: { textAlign: 'center' },
});
