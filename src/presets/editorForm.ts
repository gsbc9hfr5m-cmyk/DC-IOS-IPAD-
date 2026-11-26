/**
 * 프리셋 편집 화면의 입력값(문자열) ↔ PresetConfig 변환과 검증.
 */
import { strings } from '@/strings';

import type { DateFilter, PresetConfig, Schedule, YearSelection } from './types';

const inv = strings.presets.invalid;

export type PresetForm = {
  name: string;
  config: PresetConfig;
  // 텍스트로 편집하는 값들
  days: string;
  beforeDate: string;
  keywordInclude: string;
  keywordExclude: string;
  maxRecommends: string;
  maxViews: string;
  gbYearList: string;
  gbFrom: string;
  gbTo: string;
  gbUpTo: string;
  gbMonths: string;
  gbAuthorInclude: string;
  gbAuthorExclude: string;
  gbKeywordInclude: string;
  gbKeywordExclude: string;
  schedule: Schedule;
};

export const splitList = (s: string): string[] =>
  s
    .split(/[,，\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

const joinList = (a: string[]) => a.join(', ');

export function toForm(name: string, c: PresetConfig, schedule: Schedule | null): PresetForm {
  const y = c.guestbook.years;
  return {
    name,
    config: c,
    days: c.date.mode === 'olderThanDays' ? String(c.date.days) : '30',
    beforeDate: c.date.mode === 'before' ? c.date.date : '',
    keywordInclude: joinList(c.keywords.include),
    keywordExclude: joinList(c.keywords.exclude),
    maxRecommends: c.metrics.maxRecommends === null ? '' : String(c.metrics.maxRecommends),
    maxViews: c.metrics.maxViews === null ? '' : String(c.metrics.maxViews),
    gbYearList: y.mode === 'list' ? y.years.join(', ') : '',
    gbFrom: y.mode === 'range' ? String(y.from) : '',
    gbTo: y.mode === 'range' ? String(y.to) : '',
    gbUpTo: y.mode === 'upTo' ? String(y.year) : '',
    gbMonths: c.guestbook.months.join(', '),
    gbAuthorInclude: joinList(c.guestbook.authors.include),
    gbAuthorExclude: joinList(c.guestbook.authors.exclude),
    gbKeywordInclude: joinList(c.guestbook.keywords.include),
    gbKeywordExclude: joinList(c.guestbook.keywords.exclude),
    schedule: schedule ?? { enabled: false, weekdays: [], time: '03:00' },
  };
}

const isYear = (n: number) => Number.isInteger(n) && n >= 1999 && n <= 2100;

function optionalNonNegInt(s: string): number | null | 'invalid' {
  if (s.trim() === '') return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 ? n : 'invalid';
}

export type FormResult = { ok: true; name: string; config: PresetConfig; schedule: Schedule | null } | { ok: false; error: string };

export function fromForm(f: PresetForm): FormResult {
  const c = f.config;
  if (!c.kinds.post && !c.kinds.comment && !c.kinds.guestbook) return { ok: false, error: inv.noKind };
  if ((c.kinds.post || c.kinds.comment) && !c.galleryTypes.general && !c.galleryTypes.minor && !c.galleryTypes.mini) {
    return { ok: false, error: inv.noGalleryType };
  }
  if (c.galleryScope.mode !== 'all' && c.galleryScope.galleryIds.length === 0) return { ok: false, error: inv.galleries };

  let date: DateFilter = { mode: 'any' };
  if (c.date.mode === 'olderThanDays') {
    const days = Number(f.days);
    if (!Number.isInteger(days) || days < 0) return { ok: false, error: inv.days };
    date = { mode: 'olderThanDays', days };
  } else if (c.date.mode === 'before') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.beforeDate.trim())) return { ok: false, error: inv.date };
    date = { mode: 'before', date: f.beforeDate.trim() };
  }

  const maxRecommends = optionalNonNegInt(f.maxRecommends);
  const maxViews = optionalNonNegInt(f.maxViews);
  if (maxRecommends === 'invalid' || maxViews === 'invalid') return { ok: false, error: inv.days };

  let years: YearSelection = { mode: 'all' };
  const ym = c.guestbook.years.mode;
  if (ym === 'list') {
    const list = splitList(f.gbYearList).map(Number);
    if (!list.length || !list.every(isYear)) return { ok: false, error: inv.years };
    years = { mode: 'list', years: [...new Set(list)].sort() };
  } else if (ym === 'range') {
    const from = Number(f.gbFrom);
    const to = Number(f.gbTo);
    if (!isYear(from) || !isYear(to)) return { ok: false, error: inv.years };
    years = { mode: 'range', from: Math.min(from, to), to: Math.max(from, to) };
  } else if (ym === 'upTo') {
    const year = Number(f.gbUpTo);
    if (!isYear(year)) return { ok: false, error: inv.years };
    years = { mode: 'upTo', year };
  }
  const months = splitList(f.gbMonths).map(Number);
  if (!months.every((m) => Number.isInteger(m) && m >= 1 && m <= 12)) return { ok: false, error: inv.years };

  const schedule = f.schedule;
  if (schedule.enabled && !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time)) return { ok: false, error: inv.time };

  return {
    ok: true,
    name: f.name.trim() || strings.presets.defaultName,
    config: {
      ...c,
      date,
      keywords: { ...c.keywords, include: splitList(f.keywordInclude), exclude: splitList(f.keywordExclude) },
      metrics: { maxRecommends, maxViews },
      guestbook: {
        ...c.guestbook,
        writtenByMe: false,
        years,
        months: [...new Set(months)].sort((a, b) => a - b),
        authors: { include: splitList(f.gbAuthorInclude), exclude: splitList(f.gbAuthorExclude) },
        keywords: { include: splitList(f.gbKeywordInclude), exclude: splitList(f.gbKeywordExclude) },
      },
    },
    schedule: schedule.enabled || schedule.weekdays.length ? schedule : null,
  };
}
