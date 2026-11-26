import { getDb } from '@/db/db';

import type { HistoryRow } from './historyFormat';

export function loadHistory(limit = 20_000): HistoryRow[] {
  return getDb()
    .getAllSync<{
      id: number;
      run_id: string;
      at: string;
      kind: HistoryRow['kind'];
      gallery_id: string | null;
      gallery_type: string | null;
      title: string;
      result: HistoryRow['result'];
      reason: string | null;
    }>('SELECT * FROM history ORDER BY at DESC LIMIT ?', limit)
    .map((r) => ({
      id: r.id,
      runId: r.run_id,
      at: r.at,
      kind: r.kind,
      galleryId: r.gallery_id,
      galleryType: r.gallery_type,
      title: r.title,
      result: r.result,
      reason: r.reason,
    }));
}

export type BackupEntry = { runId: string; dir: string; format: string; itemCount: number; bytes: number; createdAt: string; presetName: string | null };

export function listBackups(): BackupEntry[] {
  return getDb()
    .getAllSync<{ run_id: string; dir: string; format: string; item_count: number; bytes: number; created_at: string; preset_name: string | null }>(
      `SELECT b.*, r.preset_name FROM backups b LEFT JOIN runs r ON r.id = b.run_id ORDER BY b.created_at DESC`,
    )
    .map((r) => ({
      runId: r.run_id,
      dir: r.dir,
      format: r.format,
      itemCount: r.item_count,
      bytes: r.bytes,
      createdAt: r.created_at,
      presetName: r.preset_name,
    }));
}

export function removeBackupRecord(runId: string): void {
  getDb().runSync('DELETE FROM backups WHERE run_id = ?', runId);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
