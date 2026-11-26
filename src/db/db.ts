/**
 * SQLite (expo-sqlite). 작업, 로그, 백업 인덱스, 프리셋, 보호 목록, 수집 캐시.
 * 비밀값은 절대 저장하지 않는다 (src/secure/secrets.ts).
 * 마이그레이션은 PRAGMA user_version으로 관리한다.
 */
import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

const MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL);

  CREATE TABLE IF NOT EXISTS presets (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    config TEXT NOT NULL,
    schedule TEXT,
    schedule_confirmed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS protected_items (
    key TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    gallery_id TEXT,
    written_at TEXT,
    added_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS galleries (
    gall_code TEXT NOT NULL,
    type_code TEXT NOT NULL,
    gall_id TEXT NOT NULL,
    PRIMARY KEY (gall_code, type_code)
  );

  CREATE TABLE IF NOT EXISTS items (
    key TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL,
    gallery TEXT NOT NULL,
    type_code TEXT NOT NULL,
    log_no TEXT NOT NULL,
    gall_code TEXT NOT NULL,
    post_no TEXT NOT NULL,
    comment_no TEXT,
    subject TEXT NOT NULL,
    memo_text TEXT NOT NULL,
    memo_html TEXT NOT NULL,
    written_at TEXT NOT NULL,
    is_reply INTEGER NOT NULL,
    collected_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS items_kind ON items(kind);

  CREATE TABLE IF NOT EXISTS guestbook_items (
    key TEXT PRIMARY KEY NOT NULL,
    no TEXT NOT NULL,
    json TEXT NOT NULL,
    year INTEGER NOT NULL,
    written_at TEXT NOT NULL,
    collected_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS guestbook_year ON guestbook_items(year);

  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY NOT NULL,
    preset_id TEXT,
    preset_name TEXT NOT NULL,
    trigger TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    finished_at TEXT,
    backup_dir TEXT,
    halt_reason TEXT,
    options TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS run_items (
    run_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    key TEXT NOT NULL,
    kind TEXT NOT NULL,
    target TEXT NOT NULL,
    status TEXT NOT NULL,
    reason TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (run_id, key)
  );
  CREATE INDEX IF NOT EXISTS run_items_status ON run_items(run_id, status, seq);

  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    at TEXT NOT NULL,
    kind TEXT NOT NULL,
    gallery_id TEXT,
    gallery_type TEXT,
    title TEXT NOT NULL,
    result TEXT NOT NULL,
    reason TEXT
  );
  CREATE INDEX IF NOT EXISTS history_at ON history(at);

  CREATE TABLE IF NOT EXISTS backups (
    run_id TEXT PRIMARY KEY NOT NULL,
    dir TEXT NOT NULL,
    format TEXT NOT NULL,
    item_count INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
  // v2: 갤러리별 목록 화면 (갤러리 이름)
  `
  ALTER TABLE items ADD COLUMN gall_name TEXT NOT NULL DEFAULT '';
  CREATE INDEX IF NOT EXISTS items_gallery ON items(gallery, gall_code, kind);
  `,
];

let db: SQLiteDatabase | null = null;

export function getDb(): SQLiteDatabase {
  if (db) return db;
  db = openDatabaseSync('dccleaner.db');
  db.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const current = db.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.withTransactionSync(() => {
      db!.execSync(MIGRATIONS[v]!);
      db!.execSync(`PRAGMA user_version = ${v + 1}`);
    });
  }
  return db;
}

export const nowIso = () => new Date().toISOString();

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
