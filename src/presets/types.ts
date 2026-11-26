/**
 * 삭제 프리셋 (spec 2-3, 2-18). 설정 내보내기(9단계)에 그대로 들어가므로 비밀값을 넣지 않는다.
 */
import type { GalleryType } from '@/dc/config';

export type YearSelection =
  | { mode: 'all' }
  /** 복수 선택 (예: 2019, 2021) */
  | { mode: 'list'; years: number[] }
  /** 범위 (예: 2018~2020, 양끝 포함) */
  | { mode: 'range'; from: number; to: number }
  /** "N년 이전 전부" (N년 포함) */
  | { mode: 'upTo'; year: number };

export type KeywordFilter = { include: string[]; exclude: string[] };

export type DateFilter = { mode: 'any' } | { mode: 'olderThanDays'; days: number } | { mode: 'before'; date: string };

export type PresetConfig = {
  version: 1;
  kinds: { post: boolean; comment: boolean; guestbook: boolean };
  galleryScope: { mode: 'all' | 'include' | 'exclude'; galleryIds: string[] };
  galleryTypes: Record<Exclude<GalleryType, 'person'>, boolean>;
  date: DateFilter;
  keywords: KeywordFilter & { target: 'title' | 'content' | 'both' };
  /** 글만 해당. 이 값 이하인 글만 지운다 (null이면 조건 없음). 원문 조회가 필요해 실행 중에 검사한다. */
  metrics: { maxRecommends: number | null; maxViews: number | null };
  guestbook: {
    onMyGallog: boolean;
    /** 디시가 목록을 제공하지 않아 항상 false (dc-protocol §4-D) */
    writtenByMe: false;
    years: YearSelection;
    /** 1~12. 비어 있으면 모든 달 */
    months: number[];
    authors: KeywordFilter;
    keywords: KeywordFilter;
  };
};

export type Schedule = {
  enabled: boolean;
  /** 0=일 … 6=토. 비어 있으면 매일 */
  weekdays: number[];
  /** 'HH:MM' (이 시각 이후 가능한 시점에 실행) */
  time: string;
};

export type Preset = {
  id: string;
  name: string;
  config: PresetConfig;
  schedule: Schedule | null;
  /** 스케줄 실행은 Dry-run 없이 진행되므로 생성 시 추가 확인을 받는다 (spec 2-9) */
  scheduleConfirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function defaultPresetConfig(): PresetConfig {
  return {
    version: 1,
    kinds: { post: true, comment: true, guestbook: false },
    galleryScope: { mode: 'all', galleryIds: [] },
    galleryTypes: { general: true, minor: true, mini: true },
    date: { mode: 'olderThanDays', days: 30 },
    keywords: { include: [], exclude: [], target: 'both' },
    metrics: { maxRecommends: null, maxViews: null },
    guestbook: {
      onMyGallog: true,
      writtenByMe: false,
      years: { mode: 'all' },
      months: [],
      authors: { include: [], exclude: [] },
      keywords: { include: [], exclude: [] },
    },
  };
}

/** 가져온 JSON이나 저장값을 현재 형식으로 맞춘다. 형식이 틀리면 null. */
export function normalizePresetConfig(raw: unknown): PresetConfig | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Partial<PresetConfig>;
  if (r.version !== 1) return null;
  const d = defaultPresetConfig();
  return {
    ...d,
    ...r,
    kinds: { ...d.kinds, ...r.kinds },
    galleryScope: { ...d.galleryScope, ...r.galleryScope },
    galleryTypes: { ...d.galleryTypes, ...r.galleryTypes },
    keywords: { ...d.keywords, ...r.keywords },
    metrics: { ...d.metrics, ...r.metrics },
    guestbook: { ...d.guestbook, ...r.guestbook, writtenByMe: false },
    version: 1,
  };
}
