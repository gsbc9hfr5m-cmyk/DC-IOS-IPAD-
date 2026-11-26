/**
 * 삭제 엔진 공통 타입 (spec 2-6).
 */
import type { GalleryType } from '@/dc/config';
import type { GallogItem, GuestbookItem } from '@/dc/parsers';
import type { PresetConfig } from '@/presets/types';

export type RunTrigger = 'manual' | 'schedule' | 'shortcut';

export type RunStatus = 'running' | 'paused' | 'halted' | 'completed' | 'cancelled';

/** 항목 처리 상태 (체크포인트). 최종 상태: deleted / failed / skipped / protected / unverified */
export type ItemStatus = 'pending' | 'deleted' | 'failed' | 'skipped' | 'protected' | 'unverified';

export type RunTarget = {
  key: string;
  kind: 'post' | 'comment' | 'guestbook';
  title: string;
  writtenAt: string;
  galleryId: string | null;
  gallery: GalleryType | null;
  needsMetrics: boolean;
  replyCount: number;
  gallog?: GallogItem;
  guestbook?: GuestbookItem;
};

export type RunOptions = {
  /** 예전 프리셋 실행에서만 있다 (추천수/조회수 조건). 갤러리 선택 삭제에는 없다. */
  presetConfig?: PresetConfig;
  backupEnabled: boolean;
  backupRequired: boolean;
  backupFormat: 'json' | 'html';
  failLimit: number;
  strictVerify: boolean;
  concurrency: number;
};

export type RunCounts = Record<ItemStatus, number>;

export type RunSummary = {
  id: string;
  presetId: string | null;
  presetName: string;
  trigger: RunTrigger;
  status: RunStatus;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  backupDir: string | null;
  haltReason: string | null;
  counts: RunCounts;
  total: number;
};

export const emptyCounts = (): RunCounts => ({ pending: 0, deleted: 0, failed: 0, skipped: 0, protected: 0, unverified: 0 });
