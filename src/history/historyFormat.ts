/**
 * 삭제 이력 내보내기와 통계 계산 (spec 2-13, 2-14). 순수 함수.
 * 이력에는 제목 일부만 저장되고, 비밀번호/쿠키/API 키는 애초에 들어 있지 않다.
 */
export type HistoryRow = {
  id: number;
  runId: string;
  at: string; // ISO
  kind: 'post' | 'comment' | 'guestbook';
  galleryId: string | null;
  galleryType: string | null;
  title: string;
  result: 'deleted' | 'failed' | 'skipped' | 'protected' | 'unverified';
  reason: string | null;
};

export const RESULT_LABEL: Record<HistoryRow['result'], string> = {
  deleted: '삭제',
  failed: '실패',
  skipped: '건너뜀',
  protected: '보호됨',
  unverified: '미확인',
};

export const KIND_LABEL: Record<HistoryRow['kind'], string> = { post: '글', comment: '댓글', guestbook: '방명록' };

function csvCell(v: string | number | null): string {
  const s = v === null ? '' : String(v);
  // 수식 주입 방지: =, +, -, @ 로 시작하면 앞에 '를 붙인다
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function historyToCsv(rows: HistoryRow[]): string {
  const header = ['시각', '종류', '갤러리', '제목', '결과', '사유'];
  const lines = rows.map((r) =>
    [r.at, KIND_LABEL[r.kind], r.galleryId, r.title, RESULT_LABEL[r.result], r.reason].map(csvCell).join(','),
  );
  // 엑셀에서 한글이 깨지지 않도록 BOM
  return `﻿${[header.join(','), ...lines].join('\r\n')}\r\n`;
}

export function historyToJson(rows: HistoryRow[], exportedAt = new Date().toISOString()): string {
  return JSON.stringify({ format: 'dccleaner.history', version: 1, exportedAt, rows }, null, 2);
}

export type HistoryFilter = { query: string; result: HistoryRow['result'] | 'all'; kind: HistoryRow['kind'] | 'all' };

export function filterHistory(rows: HistoryRow[], f: HistoryFilter): HistoryRow[] {
  const q = f.query.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (f.result === 'all' || r.result === f.result) &&
      (f.kind === 'all' || r.kind === f.kind) &&
      (!q || r.title.toLowerCase().includes(q) || (r.galleryId ?? '').toLowerCase().includes(q)),
  );
}

// ───────────────────────── 통계 ─────────────────────────

export type Period = 'day' | 'week' | 'month';

/** 로컬 시각 기준 기간 키 */
export function periodKey(iso: string, p: Period): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  if (p === 'month') return `${y}-${m}`;
  if (p === 'day') return `${y}-${m}-${String(d.getDate()).padStart(2, '0')}`;
  // 주: 그 주 월요일 날짜
  const monday = new Date(y, d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
}

export type Stats = {
  total: number;
  deleted: number;
  /** 삭제 성공 / (삭제 + 실패 + 미확인). 시도가 없으면 null */
  successRate: number | null;
  byKind: Record<HistoryRow['kind'], number>;
  byResult: Record<HistoryRow['result'], number>;
  byGallery: { galleryId: string; count: number }[];
  trend: { key: string; count: number }[];
};

export function computeStats(rows: HistoryRow[], period: Period, maxBuckets = 12): Stats {
  const byKind = { post: 0, comment: 0, guestbook: 0 };
  const byResult = { deleted: 0, failed: 0, skipped: 0, protected: 0, unverified: 0 };
  const gal = new Map<string, number>();
  const trend = new Map<string, number>();
  for (const r of rows) {
    byResult[r.result]++;
    if (r.result !== 'deleted') continue;
    byKind[r.kind]++;
    // 방명록은 갤러리가 없으므로 "방명록" 항목으로 따로 센다
    const g = r.kind === 'guestbook' ? '방명록' : (r.galleryId ?? '(알 수 없음)');
    gal.set(g, (gal.get(g) ?? 0) + 1);
    const k = periodKey(r.at, period);
    trend.set(k, (trend.get(k) ?? 0) + 1);
  }
  const attempted = byResult.deleted + byResult.failed + byResult.unverified;
  return {
    total: rows.length,
    deleted: byResult.deleted,
    successRate: attempted ? byResult.deleted / attempted : null,
    byKind,
    byResult,
    byGallery: [...gal.entries()].map(([galleryId, count]) => ({ galleryId, count })).sort((a, b) => b.count - a.count),
    trend: [...trend.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => (a.key < b.key ? -1 : 1))
      .slice(-maxBuckets),
  };
}
