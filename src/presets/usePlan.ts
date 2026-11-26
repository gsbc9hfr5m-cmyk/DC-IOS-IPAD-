/**
 * 프리셋 + 수집 캐시 + 보호 목록 → 삭제 계획. Dry-run 화면과 엔진 시작이 같은 계산을 쓴다.
 */
import { useMemo, useState } from 'react';

import { useCollect } from '@/collect/collectStore';
import * as repos from '@/db/repos';

import { buildPlan, type Plan, type Target } from './filter';
import type { Preset } from './types';

export function computePlan(preset: Preset, now = new Date()): Plan {
  return buildPlan({
    config: preset.config,
    gallogItems: repos.loadGallogItems(),
    guestbookItems: repos.loadGuestbookItems(),
    galleryIds: repos.galleryIdMap(),
    protectedKeys: repos.protectedKeySet(),
    now,
  });
}

export function protectedRecord(t: Target): Omit<repos.ProtectedItem, 'addedAt'> {
  return { key: t.key, kind: t.kind, title: t.title, galleryId: t.galleryId, writtenAt: t.writtenAt };
}

export function usePlan(preset: Preset | null) {
  const version = useCollect((s) => s.version);
  const [protectVersion, setProtectVersion] = useState(0);
  const plan = useMemo(
    () => (preset ? computePlan(preset) : null),
    // version/protectVersion이 바뀌면 다시 계산한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preset, version, protectVersion],
  );
  const toggleProtect = (t: Target) => {
    if (repos.isProtected(t.key)) repos.removeProtected(t.key);
    else repos.addProtected([protectedRecord(t)]);
    setProtectVersion((v) => v + 1);
  };
  return { plan, toggleProtect };
}
