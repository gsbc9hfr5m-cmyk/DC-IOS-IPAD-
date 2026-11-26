/**
 * SQLite 접근 함수. 화면과 엔진은 SQL을 직접 쓰지 않고 이 함수들만 쓴다.
 */
import type { GallogItem, GuestbookItem } from '@/dc/parsers';
import { normalizePresetConfig, type Preset, type PresetConfig, type Schedule } from '@/presets/types';

import { getDb, newId, nowIso } from './db';

// ───────────────────────── 프리셋 ─────────────────────────

type PresetRow = {
  id: string;
  name: string;
  config: string;
  schedule: string | null;
  schedule_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
};

function toPreset(r: PresetRow): Preset | null {
  const config = normalizePresetConfig(safeJson(r.config));
  if (!config) return null;
  return {
    id: r.id,
    name: r.name,
    config,
    schedule: (safeJson(r.schedule) as Schedule | null) ?? null,
    scheduleConfirmedAt: r.schedule_confirmed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listPresets(): Preset[] {
  return getDb()
    .getAllSync<PresetRow>('SELECT * FROM presets ORDER BY updated_at DESC')
    .map(toPreset)
    .filter((p): p is Preset => p !== null);
}

export function getPreset(id: string): Preset | null {
  const r = getDb().getFirstSync<PresetRow>('SELECT * FROM presets WHERE id = ?', id);
  return r ? toPreset(r) : null;
}

export function savePreset(p: { id?: string; name: string; config: PresetConfig; schedule: Schedule | null; scheduleConfirmedAt: string | null }): string {
  const id = p.id ?? newId('preset');
  const now = nowIso();
  getDb().runSync(
    `INSERT INTO presets (id, name, config, schedule, schedule_confirmed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, config = excluded.config, schedule = excluded.schedule,
       schedule_confirmed_at = excluded.schedule_confirmed_at, updated_at = excluded.updated_at`,
    id,
    p.name,
    JSON.stringify(p.config),
    p.schedule ? JSON.stringify(p.schedule) : null,
    p.scheduleConfirmedAt,
    now,
    now,
  );
  return id;
}

export function deletePreset(id: string): void {
  getDb().runSync('DELETE FROM presets WHERE id = ?', id);
}

export function duplicatePreset(id: string): string | null {
  const p = getPreset(id);
  if (!p) return null;
  // 복제본의 스케줄은 끈다: 스케줄은 다시 명시적으로 확인받아야 한다
  return savePreset({ name: `${p.name} 복사본`, config: p.config, schedule: p.schedule ? { ...p.schedule, enabled: false } : null, scheduleConfirmedAt: null });
}

// ───────────────────────── 보호 목록 ─────────────────────────

export type ProtectedItem = { key: string; kind: string; title: string; galleryId: string | null; writtenAt: string | null; addedAt: string };

export function listProtected(): ProtectedItem[] {
  return getDb()
    .getAllSync<{ key: string; kind: string; title: string; gallery_id: string | null; written_at: string | null; added_at: string }>(
      'SELECT * FROM protected_items ORDER BY added_at DESC',
    )
    .map((r) => ({ key: r.key, kind: r.kind, title: r.title, galleryId: r.gallery_id, writtenAt: r.written_at, addedAt: r.added_at }));
}

export function protectedKeySet(): Set<string> {
  return new Set(getDb().getAllSync<{ key: string }>('SELECT key FROM protected_items').map((r) => r.key));
}

export function isProtected(key: string): boolean {
  return getDb().getFirstSync('SELECT 1 FROM protected_items WHERE key = ?', key) !== null;
}

export function addProtected(items: Omit<ProtectedItem, 'addedAt'>[]): void {
  const db = getDb();
  const now = nowIso();
  db.withTransactionSync(() => {
    for (const i of items) {
      db.runSync(
        'INSERT OR REPLACE INTO protected_items (key, kind, title, gallery_id, written_at, added_at) VALUES (?, ?, ?, ?, ?, ?)',
        i.key,
        i.kind,
        i.title.slice(0, 200),
        i.galleryId,
        i.writtenAt,
        now,
      );
    }
  });
}

export function removeProtected(key: string): void {
  getDb().runSync('DELETE FROM protected_items WHERE key = ?', key);
}

// ───────────────────────── 갤러리 ID 캐시 ─────────────────────────

export function galleryIdMap(): Map<string, string> {
  const rows = getDb().getAllSync<{ gall_code: string; type_code: string; gall_id: string }>('SELECT * FROM galleries');
  return new Map(rows.map((r) => [`${r.type_code}:${r.gall_code}`, r.gall_id]));
}

export function saveGalleryId(gallCode: string, typeCode: string, gallId: string): void {
  getDb().runSync('INSERT OR REPLACE INTO galleries (gall_code, type_code, gall_id) VALUES (?, ?, ?)', gallCode, typeCode, gallId);
}

/** 수집된 글/댓글이 있는 갤러리와 개수 (프리셋 편집 화면의 갤러리 선택용) */
export function knownGalleries(): { galleryId: string; count: number }[] {
  return getDb().getAllSync<{ galleryId: string; count: number }>(
    `SELECT g.gall_id AS galleryId, COUNT(*) AS count FROM items i
     JOIN galleries g ON g.gall_code = i.gall_code AND g.type_code = i.type_code
     GROUP BY g.gall_id ORDER BY count DESC`,
  );
}

// ───────────────────────── 수집 캐시 ─────────────────────────

type ItemRow = {
  key: string;
  kind: string;
  gallery: string;
  type_code: string;
  log_no: string;
  gall_code: string;
  gall_name: string | null;
  post_no: string;
  comment_no: string | null;
  subject: string;
  memo_text: string;
  memo_html: string;
  written_at: string;
  is_reply: number;
};

export function knownKeys(kind: 'post' | 'comment'): Set<string> {
  return new Set(getDb().getAllSync<{ key: string }>('SELECT key FROM items WHERE kind = ?', kind).map((r) => r.key));
}

/** 한 종류(post/comment)의 캐시를 통째로 바꾼다 (수집이 끝까지 성공했을 때만) */
export function replaceGallogItems(kind: 'post' | 'comment', items: { key: string; item: GallogItem }[]): void {
  writeGallogItems(kind, items, true);
}

/** 캐시에 합친다 (기존 항목 유지) */
export function upsertGallogItems(kind: 'post' | 'comment', items: { key: string; item: GallogItem }[]): void {
  writeGallogItems(kind, items, false);
}

function writeGallogItems(kind: 'post' | 'comment', items: { key: string; item: GallogItem }[], replace: boolean): void {
  const db = getDb();
  const now = nowIso();
  db.withTransactionSync(() => {
    if (replace) db.runSync('DELETE FROM items WHERE kind = ?', kind);
    for (const { key, item: i } of items) {
      db.runSync(
        `INSERT OR REPLACE INTO items (key, kind, gallery, type_code, log_no, gall_code, gall_name, post_no, comment_no, subject, memo_text, memo_html, written_at, is_reply, collected_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        key,
        i.kind,
        i.gallery,
        i.typeCode,
        i.logNo,
        i.gallCode,
        i.gallName,
        i.postNo,
        i.commentNo,
        i.subject,
        i.memoText,
        i.memoHtml,
        i.writtenAt,
        i.isReply ? 1 : 0,
        now,
      );
    }
    if (replace) setMeta(`collected.${kind}`, now);
  });
}

export function loadGallogItems(): GallogItem[] {
  return getDb().getAllSync<ItemRow>('SELECT * FROM items').map(rowToItem);
}

function rowToItem(r: ItemRow): GallogItem {
  return {
      kind: r.kind as GallogItem['kind'],
      gallery: r.gallery as GallogItem['gallery'],
      typeCode: r.type_code,
      logNo: r.log_no,
      gallCode: r.gall_code,
      gallName: r.gall_name ?? '',
      postNo: r.post_no,
      commentNo: r.comment_no,
      subject: r.subject,
      memoText: r.memo_text,
      memoHtml: r.memo_html,
      writtenAt: r.written_at,
      isReply: r.is_reply === 1,
  };
}

// ───────────────────────── 갤러리별 활동 (메인 화면) ─────────────────────────

export type GalleryGroup = {
  /** `${gallery}:${gallCode}` */
  id: string;
  gallery: GallogItem['gallery'];
  gallCode: string;
  name: string;
  posts: number;
  comments: number;
  lastWrittenAt: string;
};

export function galleryGroupId(item: Pick<GallogItem, 'gallery' | 'gallCode'>): string {
  return `${item.gallery}:${item.gallCode}`;
}

/** 내가 글/댓글을 쓴 갤러리 목록 (많이 쓴 순) */
export function galleryGroups(): GalleryGroup[] {
  return getDb()
    .getAllSync<{ gallery: string; gall_code: string; name: string | null; posts: number; comments: number; last: string }>(
      `SELECT gallery, gall_code, MAX(gall_name) AS name,
              SUM(kind = 'post') AS posts, SUM(kind = 'comment') AS comments, MAX(written_at) AS last
       FROM items GROUP BY gallery, gall_code
       ORDER BY (SUM(kind = 'post') + SUM(kind = 'comment')) DESC, last DESC`,
    )
    .map((r) => ({
      id: `${r.gallery}:${r.gall_code}`,
      gallery: r.gallery as GallogItem['gallery'],
      gallCode: r.gall_code,
      name: r.name || `갤러리 ${r.gall_code}`,
      posts: r.posts,
      comments: r.comments,
      lastWrittenAt: r.last,
    }));
}

/** 한 갤러리의 글 또는 댓글 (최신순). key는 삭제 대상 키. */
export function galleryItems(groupId: string, kind?: 'post' | 'comment'): { key: string; item: GallogItem }[] {
  const i = groupId.indexOf(':');
  const gallery = groupId.slice(0, i);
  const gallCode = groupId.slice(i + 1);
  const rows = kind
    ? getDb().getAllSync<ItemRow>('SELECT * FROM items WHERE gallery = ? AND gall_code = ? AND kind = ? ORDER BY written_at DESC', gallery, gallCode, kind)
    : getDb().getAllSync<ItemRow>('SELECT * FROM items WHERE gallery = ? AND gall_code = ? ORDER BY written_at DESC', gallery, gallCode);
  return rows.map((r) => ({ key: r.key, item: rowToItem(r) }));
}

/** 전체 목록을 끝까지 읽었을 때: 이번에 보이지 않은 항목(이미 지워진 것)을 캐시에서 뺀다 */
export function removeItemsNotIn(kind: 'post' | 'comment', keep: Set<string>): number {
  const db = getDb();
  const stale = db
    .getAllSync<{ key: string }>('SELECT key FROM items WHERE kind = ?', kind)
    .map((r) => r.key)
    .filter((k) => !keep.has(k));
  db.withTransactionSync(() => {
    for (const k of stale) db.runSync('DELETE FROM items WHERE key = ?', k);
  });
  return stale.length;
}

export function clearGallogItems(): void {
  getDb().runSync('DELETE FROM items');
}

export function removeCachedItem(key: string): void {
  getDb().runSync('DELETE FROM items WHERE key = ?', key);
  getDb().runSync('DELETE FROM guestbook_items WHERE key = ?', key);
}

export function replaceGuestbookItems(items: { key: string; item: GuestbookItem }[]): void {
  const db = getDb();
  const now = nowIso();
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM guestbook_items');
    for (const { key, item } of items) {
      db.runSync(
        'INSERT OR REPLACE INTO guestbook_items (key, no, json, year, written_at, collected_at) VALUES (?, ?, ?, ?, ?, ?)',
        key,
        item.no,
        JSON.stringify(item),
        item.year,
        item.writtenAt,
        now,
      );
    }
    setMeta('collected.guestbook', now);
  });
}

export function loadGuestbookItems(): GuestbookItem[] {
  return getDb()
    .getAllSync<{ json: string }>('SELECT json FROM guestbook_items')
    .map((r) => safeJson(r.json) as GuestbookItem)
    .filter(Boolean);
}

export function guestbookYearCounts(): { year: number; count: number }[] {
  return getDb().getAllSync<{ year: number; count: number }>(
    'SELECT year, COUNT(*) AS count FROM guestbook_items GROUP BY year ORDER BY year DESC',
  );
}

// ───────────────────────── 메타 ─────────────────────────

export function getMeta(k: string): string | null {
  return getDb().getFirstSync<{ v: string }>('SELECT v FROM meta WHERE k = ?', k)?.v ?? null;
}

export function setMeta(k: string, v: string): void {
  getDb().runSync('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)', k, v);
}

function safeJson(s: string | null): unknown {
  if (s === null) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
