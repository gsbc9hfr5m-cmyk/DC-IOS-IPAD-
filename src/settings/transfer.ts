/**
 * 설정 백업/복원 (spec 2-15): 프리셋, 보호 목록, 갤러리 목록, 설정값을 JSON 한 파일로.
 * 비밀번호, API 키, 세션 쿠키는 절대 포함하지 않는다 (이 데이터들은 애초에 이 모듈이 읽지 않는다).
 * 가져오기 시 형식과 버전 호환성을 검사한다.
 */
import { normalizePresetConfig, type Preset, type Schedule } from '@/presets/types';
import { parseProtected } from '@/presets/protectedJson';
import type { ProtectedItem } from '@/db/repos';

import { sanitizeSettings, type Settings } from './settingsStore';

export const TRANSFER_FORMAT = 'dccleaner.settings';
/** 이 앱이 읽을 수 있는 최대 버전 */
export const TRANSFER_VERSION = 1;

export type TransferBundle = {
  format: typeof TRANSFER_FORMAT;
  version: number;
  exportedAt: string;
  appVersion: string;
  settings: Settings;
  presets: { name: string; config: unknown; schedule: Schedule | null }[];
  protected: Omit<ProtectedItem, 'addedAt'>[];
  galleries: { gallCode: string; typeCode: string; gallId: string }[];
};

/** 내보낼 때 설정값에서 혹시라도 비밀처럼 보이는 키를 제거 (방어적) */
const SECRET_KEY = /pass|token|cookie|secret|apikey|api_key|session/i;

export function buildExport(p: {
  settings: Settings;
  presets: Preset[];
  protectedItems: ProtectedItem[];
  galleries: { gallCode: string; typeCode: string; gallId: string }[];
  appVersion: string;
  now?: string;
}): string {
  const settings = Object.fromEntries(Object.entries(p.settings).filter(([k]) => !SECRET_KEY.test(k))) as Settings;
  const bundle: TransferBundle = {
    format: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    exportedAt: p.now ?? new Date().toISOString(),
    appVersion: p.appVersion,
    settings,
    // 스케줄은 내보내되, 가져오면 꺼진 상태가 된다 (다시 확인받아야 함)
    presets: p.presets.map((x) => ({ name: x.name, config: x.config, schedule: x.schedule })),
    protected: p.protectedItems.map(({ addedAt: _a, ...rest }) => rest),
    galleries: p.galleries,
  };
  return JSON.stringify(bundle, null, 2);
}

export type ImportResult =
  | {
      ok: true;
      settings: Partial<Settings>;
      presets: { name: string; config: NonNullable<ReturnType<typeof normalizePresetConfig>>; schedule: Schedule | null }[];
      protectedItems: Omit<ProtectedItem, 'addedAt'>[];
      galleries: { gallCode: string; typeCode: string; gallId: string }[];
      skippedPresets: number;
    }
  | { ok: false; error: string };

export function parseImport(text: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'JSON 파일이 아닙니다.' };
  }
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: '형식이 올바르지 않습니다.' };
  const r = raw as Partial<TransferBundle>;
  if (r.format !== TRANSFER_FORMAT) return { ok: false, error: 'DC 클리너 설정 파일이 아닙니다.' };
  if (typeof r.version !== 'number' || r.version < 1) return { ok: false, error: '버전 정보가 없습니다.' };
  if (r.version > TRANSFER_VERSION) return { ok: false, error: `더 새로운 앱에서 만든 파일입니다 (버전 ${r.version}). 앱을 업데이트하세요.` };

  const presets: Extract<ImportResult, { ok: true }>['presets'] = [];
  let skippedPresets = 0;
  for (const p of Array.isArray(r.presets) ? r.presets : []) {
    const config = normalizePresetConfig(p?.config);
    if (!config || typeof p.name !== 'string') {
      skippedPresets++;
      continue;
    }
    const schedule = p.schedule && typeof p.schedule === 'object' ? { ...p.schedule, enabled: false } : null;
    presets.push({ name: p.name.slice(0, 60), config, schedule });
  }
  const protectedItems = parseProtected(JSON.stringify({ format: 'dccleaner.protected', version: 1, items: r.protected ?? [] })) ?? [];
  const galleries = (Array.isArray(r.galleries) ? r.galleries : []).filter(
    (g) => g && /^\d+$/.test(String(g.gallCode)) && /^[A-Z]$/.test(String(g.typeCode)) && /^[A-Za-z0-9_]+$/.test(String(g.gallId)),
  );
  return {
    ok: true,
    settings: sanitizeSettings((r.settings ?? {}) as Partial<Record<keyof Settings, unknown>>),
    presets,
    protectedItems,
    galleries,
    skippedPresets,
  };
}
