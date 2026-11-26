import { appendWithCap, byteLength } from '@/debug/ringLog';
import { computeStats, filterHistory, historyToCsv, periodKey, type HistoryRow } from '@/history/historyFormat';
import { defaultPresetConfig } from '@/presets/types';
import { DEFAULT_SETTINGS } from '@/settings/settingsStore';
import { buildExport, parseImport } from '@/settings/transfer';
import { parseShortcutUrl, shortcutUrl } from '@/shortcuts/shortcutUrl';

const row = (over: Partial<HistoryRow>): HistoryRow => ({
  id: 1,
  runId: 'r',
  at: '2026-11-20T10:00:00.000Z',
  kind: 'post',
  galleryId: 'programming',
  galleryType: 'general',
  title: '제목',
  result: 'deleted',
  reason: null,
  ...over,
});

describe('삭제 이력', () => {
  it('CSV: 쉼표/따옴표/줄바꿈 이스케이프, 수식 주입 방지, BOM', () => {
    const csv = historyToCsv([row({ title: '안녕, "세계"\n둘째' }), row({ id: 2, title: '=HYPERLINK("x")' })]);
    expect(csv.startsWith('﻿시각,종류,갤러리,제목,결과,사유')).toBe(true);
    expect(csv).toContain('"안녕, ""세계""\n둘째"');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('검색과 필터', () => {
    const rows = [row({ id: 1, title: '고양이' }), row({ id: 2, title: '강아지', result: 'failed' }), row({ id: 3, kind: 'comment', galleryId: 'cat' })];
    expect(filterHistory(rows, { query: '고양', result: 'all', kind: 'all' }).map((r) => r.id)).toEqual([1]);
    expect(filterHistory(rows, { query: 'cat', result: 'all', kind: 'all' }).map((r) => r.id)).toEqual([3]);
    expect(filterHistory(rows, { query: '', result: 'failed', kind: 'all' }).map((r) => r.id)).toEqual([2]);
    expect(filterHistory(rows, { query: '', result: 'all', kind: 'comment' }).map((r) => r.id)).toEqual([3]);
  });

  it('통계: 갤러리별, 방명록 별도 집계, 성공률, 추이', () => {
    const s = computeStats(
      [
        row({ galleryId: 'a' }),
        row({ galleryId: 'a', at: '2026-10-01T10:00:00.000Z' }),
        row({ galleryId: 'b' }),
        row({ kind: 'guestbook', galleryId: null }),
        row({ result: 'failed' }),
        row({ result: 'skipped' }),
      ],
      'month',
    );
    expect(s.deleted).toBe(4);
    expect(s.successRate).toBeCloseTo(4 / 5);
    expect(s.byGallery[0]).toEqual({ galleryId: 'a', count: 2 });
    expect(s.byGallery.find((g) => g.galleryId === '방명록')?.count).toBe(1);
    expect(s.byKind).toEqual({ post: 3, comment: 0, guestbook: 1 });
    expect(s.trend.map((t) => t.count)).toEqual([1, 3]);
    expect(computeStats([], 'day').successRate).toBeNull();
  });

  it('주 단위 키는 그 주 월요일', () => {
    expect(periodKey(new Date(2026, 10, 26, 12).toISOString(), 'week')).toBe('2026-11-23'); // 목 → 월
    expect(periodKey(new Date(2026, 10, 23, 1).toISOString(), 'week')).toBe('2026-11-23');
  });
});

describe('설정 백업/복원 (spec 2-15)', () => {
  const preset = {
    id: 'p1',
    name: '정리',
    config: defaultPresetConfig(),
    schedule: { enabled: true, weekdays: [1], time: '03:00' },
    scheduleConfirmedAt: '2026-01-01',
    createdAt: '',
    updatedAt: '',
  };

  it('내보낸 파일에 비밀값이 없고, 가져오면 스케줄은 꺼진다', () => {
    const text = buildExport({
      settings: { ...DEFAULT_SETTINGS, ...({ apiKey: 'SECRET-KEY', sessionCookie: 'COOKIE' } as object) },
      presets: [preset],
      protectedItems: [{ key: 'p:1:2', kind: 'post', title: 't', galleryId: 'g', writtenAt: null, addedAt: 'x' }],
      galleries: [{ gallCode: '100', typeCode: 'G', gallId: 'programming' }],
      appVersion: '0.1.0',
    });
    expect(text).not.toMatch(/SECRET-KEY|COOKIE|password/i);
    const r = parseImport(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.presets[0]!.schedule?.enabled).toBe(false);
    expect(r.protectedItems.map((p) => p.key)).toEqual(['p:1:2']);
    expect(r.galleries).toHaveLength(1);
    expect(r.settings.failLimit).toBe(DEFAULT_SETTINGS.failLimit);
  });

  it('버전 호환성과 형식 검사', () => {
    expect(parseImport('{').ok).toBe(false);
    expect(parseImport(JSON.stringify({ format: 'x', version: 1 })).ok).toBe(false);
    const future = parseImport(JSON.stringify({ format: 'dccleaner.settings', version: 99 }));
    expect(future.ok === false && future.error).toContain('더 새로운');
    const partial = parseImport(JSON.stringify({ format: 'dccleaner.settings', version: 1, presets: [{ name: 'x', config: { version: 7 } }] }));
    expect(partial.ok && partial.skippedPresets).toBe(1);
  });
});

describe('디버그 로그 크기 상한', () => {
  it('상한을 넘으면 오래된 줄부터 버린다', () => {
    let log = '';
    for (let i = 0; i < 100; i++) log = appendWithCap(log, `line-${i}-${'x'.repeat(20)}`, 400);
    expect(byteLength(log)).toBeLessThanOrEqual(400);
    expect(log).toContain('line-99');
    expect(log).not.toContain('line-0-');
  });

  it('한글 바이트 길이', () => {
    expect(byteLength('가')).toBe(3);
    expect(byteLength('a')).toBe(1);
    expect(byteLength('🙂')).toBe(4);
  });
});

describe('단축어 URL (spec 2-12)', () => {
  it('파싱', () => {
    expect(parseShortcutUrl('dccleaner://run?preset=preset_abc')).toBeNull();
    expect(parseShortcutUrl('/resume')).toEqual({ action: 'resume' });
    expect(parseShortcutUrl('dccleaner://pause')).toEqual({ action: 'pause' });
    expect(parseShortcutUrl('dccleaner://status/')).toEqual({ action: 'status' });
    expect(parseShortcutUrl('dccleaner://run')).toBeNull();
    expect(parseShortcutUrl('dccleaner://delete-everything')).toBeNull();
    expect(parseShortcutUrl('/presets/edit')).toBeNull();
  });

  it('왕복', () => {
    expect(parseShortcutUrl(shortcutUrl({ action: 'pause' }))).toEqual({ action: 'pause' });
  });
});
