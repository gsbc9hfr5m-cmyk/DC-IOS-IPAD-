/**
 * 실행(run)과 체크포인트(run_items), 삭제 이력(history), 백업 인덱스(backups) 저장.
 * 앱이 꺼져도 run_items의 status로 이어서 재개한다. 이미 끝난 항목은 다시 처리하지 않는다.
 */
import { getDb, newId, nowIso } from '@/db/db';

import { emptyCounts, type ItemStatus, type RunOptions, type RunStatus, type RunSummary, type RunTarget, type RunTrigger } from './types';

export type RunItem = { key: string; seq: number; target: RunTarget; status: ItemStatus; reason: string | null; attempts: number };

export interface RunStore {
  createRun(p: { presetId: string | null; presetName: string; trigger: RunTrigger; options: RunOptions; targets: RunTarget[]; backupDir: string | null }): string;
  getRun(id: string): RunSummary | null;
  getOptions(id: string): RunOptions | null;
  setStatus(id: string, status: RunStatus, haltReason?: string | null): void;
  /** 다음 처리할 항목 (seq 순). 없으면 null */
  nextPending(id: string, excludeKeys: Set<string>): RunItem | null;
  updateItem(id: string, key: string, status: ItemStatus, reason: string | null, attemptsDelta?: number): void;
  /** 재시도 대상(failed, attempts < max)을 다시 pending으로 */
  requeueFailed(id: string, maxAttempts: number): number;
  addHistory(runId: string, t: RunTarget, result: ItemStatus, reason: string | null): void;
}

type RunRow = {
  id: string;
  preset_id: string | null;
  preset_name: string;
  trigger: string;
  status: string;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
  backup_dir: string | null;
  halt_reason: string | null;
  options: string;
};

function countsFor(runId: string) {
  const counts = emptyCounts();
  let total = 0;
  for (const r of getDb().getAllSync<{ status: ItemStatus; n: number }>(
    'SELECT status, COUNT(*) AS n FROM run_items WHERE run_id = ? GROUP BY status',
    runId,
  )) {
    counts[r.status] = r.n;
    total += r.n;
  }
  return { counts, total };
}

function toSummary(r: RunRow): RunSummary {
  const { counts, total } = countsFor(r.id);
  return {
    id: r.id,
    presetId: r.preset_id,
    presetName: r.preset_name,
    trigger: r.trigger as RunTrigger,
    status: r.status as RunStatus,
    startedAt: r.started_at,
    updatedAt: r.updated_at,
    finishedAt: r.finished_at,
    backupDir: r.backup_dir,
    haltReason: r.halt_reason,
    counts,
    total,
  };
}

export const sqliteRunStore: RunStore = {
  createRun({ presetId, presetName, trigger, options, targets, backupDir }) {
    const db = getDb();
    const id = newId('run');
    const now = nowIso();
    db.withTransactionSync(() => {
      db.runSync(
        `INSERT INTO runs (id, preset_id, preset_name, trigger, status, started_at, updated_at, backup_dir, options)
         VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?)`,
        id,
        presetId,
        presetName,
        trigger,
        now,
        now,
        backupDir,
        JSON.stringify(options),
      );
      targets.forEach((t, seq) => {
        db.runSync(
          `INSERT OR IGNORE INTO run_items (run_id, seq, key, kind, target, status, attempts, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?)`,
          id,
          seq,
          t.key,
          t.kind,
          JSON.stringify(t),
          now,
        );
      });
    });
    return id;
  },

  getRun(id) {
    const r = getDb().getFirstSync<RunRow>('SELECT * FROM runs WHERE id = ?', id);
    return r ? toSummary(r) : null;
  },

  getOptions(id) {
    const r = getDb().getFirstSync<{ options: string }>('SELECT options FROM runs WHERE id = ?', id);
    if (!r) return null;
    try {
      return JSON.parse(r.options) as RunOptions;
    } catch {
      return null;
    }
  },

  setStatus(id, status, haltReason = null) {
    const now = nowIso();
    const final = status === 'completed' || status === 'cancelled';
    getDb().runSync(
      'UPDATE runs SET status = ?, halt_reason = ?, updated_at = ?, finished_at = CASE WHEN ? THEN ? ELSE finished_at END WHERE id = ?',
      status,
      haltReason,
      now,
      final ? 1 : 0,
      now,
      id,
    );
  },

  nextPending(id, excludeKeys) {
    const rows = getDb().getAllSync<{ key: string; seq: number; target: string; status: ItemStatus; reason: string | null; attempts: number }>(
      `SELECT key, seq, target, status, reason, attempts FROM run_items WHERE run_id = ? AND status = 'pending' ORDER BY seq LIMIT ?`,
      id,
      excludeKeys.size + 1,
    );
    const r = rows.find((x) => !excludeKeys.has(x.key));
    if (!r) return null;
    return { key: r.key, seq: r.seq, target: JSON.parse(r.target) as RunTarget, status: r.status, reason: r.reason, attempts: r.attempts };
  },

  updateItem(id, key, status, reason, attemptsDelta = 0) {
    const now = nowIso();
    getDb().runSync(
      'UPDATE run_items SET status = ?, reason = ?, attempts = attempts + ?, updated_at = ? WHERE run_id = ? AND key = ?',
      status,
      reason,
      attemptsDelta,
      now,
      id,
      key,
    );
    getDb().runSync('UPDATE runs SET updated_at = ? WHERE id = ?', now, id);
  },

  requeueFailed(id, maxAttempts) {
    return getDb().runSync(
      `UPDATE run_items SET status = 'pending' WHERE run_id = ? AND status = 'failed' AND attempts < ?`,
      id,
      maxAttempts,
    ).changes;
  },

  addHistory(runId, t, result, reason) {
    getDb().runSync(
      'INSERT INTO history (run_id, at, kind, gallery_id, gallery_type, title, result, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      runId,
      nowIso(),
      t.kind,
      t.galleryId,
      t.gallery,
      t.title.slice(0, 60),
      result,
      reason,
    );
  },
};

// ───────────────────────── 조회 (화면용) ─────────────────────────

export function listRuns(limit = 50): RunSummary[] {
  return getDb().getAllSync<RunRow>('SELECT * FROM runs ORDER BY started_at DESC LIMIT ?', limit).map(toSummary);
}

/** 진행 중이거나 멈춘(재개 가능한) 최근 실행 */
export function activeRun(): RunSummary | null {
  const r = getDb().getFirstSync<RunRow>(
    `SELECT * FROM runs WHERE status IN ('running', 'paused', 'halted') ORDER BY started_at DESC LIMIT 1`,
  );
  return r ? toSummary(r) : null;
}

export function lastFinishedRun(): RunSummary | null {
  const r = getDb().getFirstSync<RunRow>(`SELECT * FROM runs WHERE status IN ('completed', 'cancelled') ORDER BY finished_at DESC LIMIT 1`);
  return r ? toSummary(r) : null;
}

/** 앱이 실행 도중 종료됐으면 running → paused 로 바꿔 재개 대기 상태로 둔다 */
export function markInterruptedRuns(): void {
  getDb().runSync(`UPDATE runs SET status = 'paused', halt_reason = '앱이 종료되어 멈췄습니다. 이어서 실행할 수 있습니다.' WHERE status = 'running'`);
}

export function recordBackup(runId: string, dir: string, format: string, itemCount: number, bytes: number): void {
  getDb().runSync(
    'INSERT OR REPLACE INTO backups (run_id, dir, format, item_count, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    runId,
    dir,
    format,
    itemCount,
    bytes,
    nowIso(),
  );
}
