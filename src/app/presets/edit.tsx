import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { getPreset, guestbookYearCounts, knownGalleries, savePreset } from '@/db/repos';
import { fromForm, toForm, type PresetForm } from '@/presets/editorForm';
import { defaultPresetConfig, type PresetConfig } from '@/presets/types';
import { nowIso } from '@/db/db';
import { syncScheduleNotifications } from '@/schedule/scheduler';
import { strings } from '@/strings';
import { colors } from '@/ui/colors';
import { Chip, GlassButton, OptionRow, Section, SwitchRow, Text, TextField } from '@/ui/components';
import { Screen } from '@/ui/Screen';

const s = strings.presets;

export default function PresetEditScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = useMemo(() => (id ? getPreset(id) : null), [id]);
  const [form, setForm] = useState<PresetForm>(() =>
    existing ? toForm(existing.name, existing.config, existing.schedule) : toForm('', defaultPresetConfig(), null),
  );
  const [galleryDraft, setGalleryDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const galleries = useMemo(() => knownGalleries(), []);
  const yearCounts = useMemo(() => guestbookYearCounts(), []);

  const c = form.config;
  const setC = (patch: Partial<PresetConfig>) => setForm((f) => ({ ...f, config: { ...f.config, ...patch } }));
  const setF = (patch: Partial<PresetForm>) => setForm((f) => ({ ...f, ...patch }));
  const setGb = (patch: Partial<PresetConfig['guestbook']>) => setC({ guestbook: { ...c.guestbook, ...patch } });

  const toggleGallery = (gid: string) => {
    const ids = c.galleryScope.galleryIds;
    setC({ galleryScope: { ...c.galleryScope, galleryIds: ids.includes(gid) ? ids.filter((x) => x !== gid) : [...ids, gid] } });
  };

  const persist = (result: Extract<ReturnType<typeof fromForm>, { ok: true }>, confirmedAt: string | null) => {
    savePreset({ id: existing?.id, name: result.name, config: result.config, schedule: result.schedule, scheduleConfirmedAt: confirmedAt });
    void syncScheduleNotifications();
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  };

  const onSave = () => {
    const result = fromForm(form);
    if (!result.ok) {
      setError(result.error);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    setError(null);
    const scheduleOn = result.schedule?.enabled === true;
    // 스케줄을 새로 켜거나 조건이 바뀌면 한 번 더 명시적으로 확인받는다 (spec 2-9)
    const unchanged = existing?.scheduleConfirmedAt && JSON.stringify(existing.config) === JSON.stringify(result.config);
    if (scheduleOn && !unchanged) {
      Alert.alert(s.schedule.confirmTitle, s.schedule.confirmBody, [
        { text: strings.common.cancel, style: 'cancel' },
        { text: s.schedule.confirmOk, style: 'destructive', onPress: () => persist(result, nowIso()) },
      ]);
      return;
    }
    persist(result, scheduleOn ? (existing?.scheduleConfirmedAt ?? null) : null);
  };

  const sch = form.schedule;

  return (
    <>
      <Stack.Screen options={{ title: existing ? s.editTitle : s.newTitle, headerLargeTitle: false }} />
      <Screen>
        <Section>
          <TextField label={s.name} value={form.name} onChangeText={(name) => setF({ name })} placeholder={s.namePlaceholder} last />
        </Section>

        <Section title={s.sections.kinds}>
          <SwitchRow label={s.kinds.post} help="targetKinds" value={c.kinds.post} onChange={(post) => setC({ kinds: { ...c.kinds, post } })} />
          <SwitchRow label={s.kinds.comment} value={c.kinds.comment} onChange={(comment) => setC({ kinds: { ...c.kinds, comment } })} />
          <SwitchRow
            label={s.kinds.guestbook}
            value={c.kinds.guestbook}
            onChange={(guestbook) => setC({ kinds: { ...c.kinds, guestbook } })}
            last
          />
        </Section>

        {c.kinds.post || c.kinds.comment ? (
          <>
            <Section title={s.sections.galleryTypes}>
              {(['general', 'minor', 'mini'] as const).map((g, i, arr) => (
                <SwitchRow
                  key={g}
                  label={s.galleryTypes[g]}
                  help={i === 0 ? 'galleryTypes' : undefined}
                  value={c.galleryTypes[g]}
                  onChange={(v) => setC({ galleryTypes: { ...c.galleryTypes, [g]: v } })}
                  last={i === arr.length - 1}
                />
              ))}
            </Section>

            <Section title={s.sections.scope}>
              {(['all', 'include', 'exclude'] as const).map((m, i, arr) => (
                <OptionRow
                  key={m}
                  label={s.scope[m]}
                  help={i === 0 ? 'galleryScope' : undefined}
                  selected={c.galleryScope.mode === m}
                  onPress={() => setC({ galleryScope: { ...c.galleryScope, mode: m } })}
                  last={i === arr.length - 1 && c.galleryScope.mode === 'all'}
                />
              ))}
              {c.galleryScope.mode !== 'all' ? (
                <>
                  <TextField
                    label={s.galleryAdd}
                    value={galleryDraft}
                    onChangeText={setGalleryDraft}
                    placeholder={s.galleryAddPlaceholder}
                    returnKeyType="done"
                    onSubmitEditing={() => {
                      const gid = galleryDraft.trim();
                      if (/^[A-Za-z0-9_]+$/.test(gid) && !c.galleryScope.galleryIds.includes(gid)) toggleGallery(gid);
                      setGalleryDraft('');
                    }}
                  />
                  <View style={styles.chips}>
                    {c.galleryScope.galleryIds.map((gid) => (
                      <Chip key={gid} label={gid} selected onPress={() => toggleGallery(gid)} />
                    ))}
                  </View>
                  <Text variant="footnote" secondary style={styles.pad}>
                    {galleries.length ? s.knownGalleries : s.knownGalleriesEmpty}
                  </Text>
                  <View style={styles.chips}>
                    {galleries
                      .filter((g) => !c.galleryScope.galleryIds.includes(g.galleryId))
                      .slice(0, 40)
                      .map((g) => (
                        <Chip key={g.galleryId} label={`${g.galleryId} (${g.count})`} selected={false} onPress={() => toggleGallery(g.galleryId)} />
                      ))}
                  </View>
                </>
              ) : null}
            </Section>

            <Section title={s.sections.date}>
              {(['any', 'olderThanDays', 'before'] as const).map((m, i) => (
                <OptionRow
                  key={m}
                  label={s.date[m]}
                  help={i === 0 ? 'dateFilter' : undefined}
                  selected={c.date.mode === m}
                  onPress={() =>
                    setC({ date: m === 'any' ? { mode: 'any' } : m === 'olderThanDays' ? { mode: m, days: Number(form.days) || 30 } : { mode: m, date: form.beforeDate } })
                  }
                />
              ))}
              {c.date.mode === 'olderThanDays' ? (
                <TextField label={s.days} value={form.days} onChangeText={(days) => setF({ days })} keyboardType="number-pad" last />
              ) : null}
              {c.date.mode === 'before' ? (
                <TextField label={s.beforeDate} value={form.beforeDate} onChangeText={(beforeDate) => setF({ beforeDate })} placeholder="2023-01-01" last />
              ) : null}
            </Section>

            <Section title={s.sections.keywords}>
              {(['both', 'title', 'content'] as const).map((t, i) => (
                <OptionRow
                  key={t}
                  label={s.keywordTarget[t]}
                  help={i === 0 ? 'keywordFilter' : undefined}
                  selected={c.keywords.target === t}
                  onPress={() => setC({ keywords: { ...c.keywords, target: t } })}
                />
              ))}
              <TextField label={s.keywordInclude} value={form.keywordInclude} onChangeText={(keywordInclude) => setF({ keywordInclude })} />
              <TextField label={s.keywordExclude} value={form.keywordExclude} onChangeText={(keywordExclude) => setF({ keywordExclude })} last />
            </Section>

            {c.kinds.post ? (
              <Section title={s.sections.metrics}>
                <TextField
                  label={s.maxRecommends}
                  help="metricsFilter"
                  value={form.maxRecommends}
                  onChangeText={(maxRecommends) => setF({ maxRecommends })}
                  placeholder={s.noLimit}
                  keyboardType="number-pad"
                />
                <TextField
                  label={s.maxViews}
                  value={form.maxViews}
                  onChangeText={(maxViews) => setF({ maxViews })}
                  placeholder={s.noLimit}
                  keyboardType="number-pad"
                  last
                />
              </Section>
            ) : null}
          </>
        ) : null}

        {c.kinds.guestbook ? (
          <>
            <Section title={s.sections.guestbook}>
              <SwitchRow label={s.gbOnMyGallog} help="guestbookOnMyGallog" value={c.guestbook.onMyGallog} onChange={(onMyGallog) => setGb({ onMyGallog })} />
              <SwitchRow label={s.gbWrittenByMe} help="guestbookWrittenByMe" value={false} onChange={() => {}} disabled />
              <TextField label={s.gbAuthorInclude} value={form.gbAuthorInclude} onChangeText={(gbAuthorInclude) => setF({ gbAuthorInclude })} />
              <TextField label={s.gbAuthorExclude} value={form.gbAuthorExclude} onChangeText={(gbAuthorExclude) => setF({ gbAuthorExclude })} />
              <TextField label={s.gbKeywordInclude} value={form.gbKeywordInclude} onChangeText={(gbKeywordInclude) => setF({ gbKeywordInclude })} />
              <TextField label={s.gbKeywordExclude} value={form.gbKeywordExclude} onChangeText={(gbKeywordExclude) => setF({ gbKeywordExclude })} last />
            </Section>

            <Section title={s.sections.guestbookYears}>
              {(['all', 'list', 'range', 'upTo'] as const).map((m, i) => (
                <OptionRow
                  key={m}
                  label={s.gbYears[m]}
                  help={i === 0 ? 'guestbookYears' : undefined}
                  selected={c.guestbook.years.mode === m}
                  onPress={() =>
                    setGb({
                      years:
                        m === 'all'
                          ? { mode: 'all' }
                          : m === 'list'
                            ? { mode: 'list', years: [] }
                            : m === 'range'
                              ? { mode: 'range', from: 2018, to: 2020 }
                              : { mode: 'upTo', year: 2020 },
                    })
                  }
                />
              ))}
              {c.guestbook.years.mode === 'list' ? (
                <TextField label={s.gbYearList} value={form.gbYearList} onChangeText={(gbYearList) => setF({ gbYearList })} placeholder="2019, 2021" />
              ) : null}
              {c.guestbook.years.mode === 'range' ? (
                <>
                  <TextField label={s.gbFrom} value={form.gbFrom} onChangeText={(gbFrom) => setF({ gbFrom })} keyboardType="number-pad" placeholder="2018" />
                  <TextField label={s.gbTo} value={form.gbTo} onChangeText={(gbTo) => setF({ gbTo })} keyboardType="number-pad" placeholder="2020" />
                </>
              ) : null}
              {c.guestbook.years.mode === 'upTo' ? (
                <TextField label={s.gbUpTo} value={form.gbUpTo} onChangeText={(gbUpTo) => setF({ gbUpTo })} keyboardType="number-pad" placeholder="2020" />
              ) : null}
              <TextField label={s.gbMonths} value={form.gbMonths} onChangeText={(gbMonths) => setF({ gbMonths })} placeholder="1, 2, 12" last />
            </Section>
            {yearCounts.length ? (
              <Text variant="footnote" secondary style={styles.pad}>
                {`${s.gbYearCounts}: ${yearCounts.map((y) => `${y.year}년 ${y.count}개`).join(' · ')}`}
              </Text>
            ) : null}
          </>
        ) : null}

        <Section title={s.sections.schedule} footer={s.schedule.notice}>
          <SwitchRow label={s.schedule.enabled} help="schedule" value={sch.enabled} onChange={(enabled) => setF({ schedule: { ...sch, enabled } })} />
          {sch.enabled ? (
            <>
              <Text variant="footnote" secondary style={[styles.pad, styles.top]}>
                {s.schedule.weekdays}
              </Text>
              <View style={styles.chips}>
                {s.weekdayNames.map((n, d) => (
                  <Chip
                    key={n}
                    label={n}
                    selected={sch.weekdays.includes(d)}
                    onPress={() =>
                      setF({
                        schedule: { ...sch, weekdays: sch.weekdays.includes(d) ? sch.weekdays.filter((x) => x !== d) : [...sch.weekdays, d].sort() },
                      })
                    }
                  />
                ))}
              </View>
              <TextField label={s.schedule.time} value={sch.time} onChangeText={(time) => setF({ schedule: { ...sch, time } })} placeholder="03:00" last />
            </>
          ) : null}
        </Section>

        {error ? <Text style={[styles.pad, { color: colors.destructive }]}>{error}</Text> : null}
        <GlassButton label={s.save} icon="check" prominent onPress={onSave} />
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  pad: { paddingHorizontal: 16 },
  top: { paddingTop: 8 },
});
