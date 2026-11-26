import type { GallogItem, GuestbookItem } from '@/dc/parsers';
import { fromForm, splitList, toForm } from '@/presets/editorForm';
import { buildPlan, dateMatches, gallogKey, matchesKeywords, metricsAllowDelete, yearSelected } from '@/presets/filter';
import { parseProtected, serializeProtected } from '@/presets/protectedJson';
import { defaultPresetConfig, normalizePresetConfig, type PresetConfig } from '@/presets/types';

const NOW = new Date('2026-11-26T12:00:00+09:00');

function post(over: Partial<GallogItem> = {}): GallogItem {
  return {
    kind: 'post',
    gallery: 'general',
    typeCode: 'G',
    logNo: '1',
    gallCode: '100',
    postNo: '9000',
    commentNo: null,
    subject: '제목',
    memoHtml: '',
    memoText: '',
    writtenAt: '2024-01-01T10:00:00',
    isReply: false,
    ...over,
  };
}
const comment = (over: Partial<GallogItem> = {}) =>
  post({ kind: 'comment', typeCode: 'R', commentNo: '555', memoText: '댓글 내용', ...over });

function gb(year: number, over: Partial<GuestbookItem> = {}): GuestbookItem {
  return {
    no: String(year * 10 + (over.no ? 0 : 1)),
    headnum: '1',
    authorId: 'visitor',
    authorName: '방문자',
    isMember: true,
    memoText: '안녕',
    writtenAt: `${year}-06-15T09:00:00`,
    year,
    secret: false,
    canDelete: true,
    replies: [],
    ...over,
  };
}

const ids = new Map([
  ['G:100', 'programming'],
  ['R:100', 'programming'],
  ['G:200', 'game'],
]);

function plan(config: Partial<PresetConfig>, items: GallogItem[] = [], guest: GuestbookItem[] = [], protectedKeys: string[] = []) {
  return buildPlan({
    config: { ...defaultPresetConfig(), date: { mode: 'any' }, ...config },
    gallogItems: items,
    guestbookItems: guest,
    galleryIds: ids,
    protectedKeys: new Set(protectedKeys),
    now: NOW,
  });
}

describe('보호 목록 (spec 2-4)', () => {
  it('보호한 항목은 어떤 조건에서도 삭제 대상에 들어가지 않는다', () => {
    const items = [post({ postNo: '1' }), post({ postNo: '2' }), comment()];
    const keyP1 = gallogKey(items[0]!);
    const keyC = gallogKey(items[2]!);
    const p = plan({}, items, [], [keyP1, keyC]);
    expect(p.targets.map((t) => t.key)).toEqual([gallogKey(items[1]!)]);
    expect(p.protectedMatches.map((t) => t.key).sort()).toEqual([keyC, keyP1].sort());
  });

  it('방명록도 보호된다', () => {
    const g = gb(2019);
    const p = plan({ kinds: { post: false, comment: false, guestbook: true } }, [], [g], [`g:${g.no}`]);
    expect(p.targets).toHaveLength(0);
    expect(p.protectedMatches).toHaveLength(1);
  });

  it('JSON 내보내기 → 가져오기 왕복, 잘못된 키는 버린다', () => {
    const text = serializeProtected([
      { key: 'p:100:9000', kind: 'post', title: '글', galleryId: 'programming', writtenAt: '2024-01-01', addedAt: 'x' },
      { key: 'g:77', kind: 'guestbook', title: '방명록', galleryId: null, writtenAt: null, addedAt: 'x' },
    ]);
    const parsed = parseProtected(text)!;
    expect(parsed.map((p) => p.key)).toEqual(['p:100:9000', 'g:77']);
    const bad = JSON.stringify({ format: 'dccleaner.protected', version: 1, items: [{ key: '../etc' }, { key: 'c:1:22' }] });
    expect(parseProtected(bad)!.map((p) => p.key)).toEqual(['c:1:22']);
    expect(parseProtected('not json')).toBeNull();
    expect(parseProtected(JSON.stringify({ format: 'other', version: 1, items: [] }))).toBeNull();
  });
});

describe('필터', () => {
  it('대상 종류', () => {
    const items = [post(), comment()];
    expect(plan({ kinds: { post: true, comment: false, guestbook: false } }, items).counts).toEqual({ post: 1, comment: 0, guestbook: 0 });
    expect(plan({ kinds: { post: false, comment: true, guestbook: false } }, items).counts).toEqual({ post: 0, comment: 1, guestbook: 0 });
  });

  it('갤러리 포함/제외, ID를 모르면 포함/제외 모드에서 제외', () => {
    const items = [post({ gallCode: '100' }), post({ gallCode: '200', postNo: '2' }), post({ gallCode: '999', postNo: '3' })];
    expect(plan({ galleryScope: { mode: 'include', galleryIds: ['game'] } }, items).targets.map((t) => t.galleryId)).toEqual(['game']);
    expect(plan({ galleryScope: { mode: 'exclude', galleryIds: ['game'] } }, items).targets.map((t) => t.galleryId)).toEqual(['programming']);
    expect(plan({ galleryScope: { mode: 'all', galleryIds: [] } }, items).targets).toHaveLength(3);
  });

  it('갤러리 종류', () => {
    const items = [post(), post({ gallery: 'minor', typeCode: 'E', postNo: '2' }), post({ gallery: 'mini', typeCode: 'N', postNo: '3' })];
    const p = plan({ galleryTypes: { general: false, minor: true, mini: false } }, items);
    expect(p.targets.map((t) => t.gallery)).toEqual(['minor']);
  });

  it('기간: N일 지난 것, 특정 날짜 이전', () => {
    expect(dateMatches('2026-11-20T12:00:00', { mode: 'olderThanDays', days: 7 }, NOW)).toBe(false);
    expect(dateMatches('2026-11-18T12:00:00', { mode: 'olderThanDays', days: 7 }, NOW)).toBe(true);
    expect(dateMatches('2023-12-31T23:59:59', { mode: 'before', date: '2024-01-01' }, NOW)).toBe(true);
    expect(dateMatches('2024-01-01T00:00:00', { mode: 'before', date: '2024-01-01' }, NOW)).toBe(false);
  });

  it('키워드 포함/제외 (대소문자 무시)', () => {
    expect(matchesKeywords('Hello 세계', { include: ['hello'], exclude: [] })).toBe(true);
    expect(matchesKeywords('Hello 세계', { include: ['없음'], exclude: [] })).toBe(false);
    expect(matchesKeywords('Hello 세계', { include: [], exclude: ['세계'] })).toBe(false);
    const items = [post({ subject: '공지 아님' }), post({ postNo: '2', subject: '잡담' })];
    expect(plan({ keywords: { include: [], exclude: ['공지'], target: 'title' } }, items).targets.map((t) => t.title)).toEqual(['잡담']);
  });

  it('추천수/조회수: 값을 모르면 지우지 않는다', () => {
    const m = { maxRecommends: 5, maxViews: null };
    expect(metricsAllowDelete(m, 100, 3)).toBe(true);
    expect(metricsAllowDelete(m, 100, 6)).toBe(false);
    expect(metricsAllowDelete(m, 100, null)).toBe(false);
    expect(metricsAllowDelete({ maxRecommends: null, maxViews: null }, null, null)).toBe(true);
    expect(plan({ metrics: m }, [post()]).targets[0]!.needsMetrics).toBe(true);
  });

  it('오래된 것부터 지운다', () => {
    const items = [post({ postNo: '2', writtenAt: '2025-01-01T00:00:00' }), post({ postNo: '1', writtenAt: '2020-01-01T00:00:00' })];
    expect(plan({}, items).targets.map((t) => t.writtenAt.slice(0, 4))).toEqual(['2020', '2025']);
  });
});

describe('방명록 연도 (spec 2-18): 연도 밖 항목은 건드리지 않는다', () => {
  const all = [2017, 2018, 2019, 2020, 2021, 2022].map((y) => gb(y, { no: String(y) }));
  const years = (sel: PresetConfig['guestbook']['years']) =>
    plan({ kinds: { post: false, comment: false, guestbook: true }, guestbook: { ...defaultPresetConfig().guestbook, years: sel } }, [], all)
      .targets.map((t) => Number(t.writtenAt.slice(0, 4)))
      .sort();

  it('복수 선택', () => expect(years({ mode: 'list', years: [2019, 2021] })).toEqual([2019, 2021]));
  it('범위 (양끝 포함, 순서 무관)', () => expect(years({ mode: 'range', from: 2020, to: 2018 })).toEqual([2018, 2019, 2020]));
  it('N년 이전 전부 (포함)', () => expect(years({ mode: 'upTo', year: 2018 })).toEqual([2017, 2018]));
  it('모든 연도', () => expect(years({ mode: 'all' })).toHaveLength(6));

  it('yearSelected', () => {
    expect(yearSelected(2019, { mode: 'list', years: [2019] })).toBe(true);
    expect(yearSelected(2020, { mode: 'list', years: [2019] })).toBe(false);
  });

  it('연도별 개수, 월, 작성자 필터, 권한 없는 항목 제외', () => {
    const items = [
      gb(2019, { no: '1', writtenAt: '2019-03-01T00:00:00' }),
      gb(2019, { no: '2', writtenAt: '2019-07-01T00:00:00', authorName: '스팸봇' }),
      gb(2019, { no: '3', canDelete: false }),
    ];
    const base = defaultPresetConfig().guestbook;
    const p = plan(
      { kinds: { post: false, comment: false, guestbook: true }, guestbook: { ...base, months: [3, 7], authors: { include: [], exclude: ['스팸'] } } },
      [],
      items,
    );
    expect(p.targets.map((t) => t.key)).toEqual(['g:1']);
    expect(p.guestbookByYear).toEqual({ 2019: 1 });
  });

  it('방명록을 끄면 하나도 넣지 않는다', () => {
    const p = plan({ kinds: { post: true, comment: true, guestbook: false } }, [], all);
    expect(p.targets).toHaveLength(0);
  });
});

describe('편집 폼', () => {
  it('왕복 변환과 검증', () => {
    const f = toForm('정리', defaultPresetConfig(), null);
    f.keywordInclude = 'a, b ,, c';
    f.config = { ...f.config, kinds: { post: false, comment: false, guestbook: true }, guestbook: { ...f.config.guestbook, years: { mode: 'range', from: 0, to: 0 } } };
    f.gbFrom = '2020';
    f.gbTo = '2018';
    const r = fromForm(f);
    expect(r.ok && r.config.keywords.include).toEqual(['a', 'b', 'c']);
    expect(r.ok && r.config.guestbook.years).toEqual({ mode: 'range', from: 2018, to: 2020 });
  });

  it('잘못된 입력', () => {
    const f = toForm('', defaultPresetConfig(), null);
    expect(fromForm({ ...f, config: { ...f.config, kinds: { post: false, comment: false, guestbook: false } } }).ok).toBe(false);
    expect(fromForm({ ...f, days: '-1' }).ok).toBe(false);
    expect(fromForm({ ...f, config: { ...f.config, galleryScope: { mode: 'include', galleryIds: [] } } }).ok).toBe(false);
    expect(fromForm({ ...f, schedule: { enabled: true, weekdays: [], time: '25:00' } }).ok).toBe(false);
    expect(splitList('x,，y\nz')).toEqual(['x', 'y', 'z']);
  });

  it('가져온 설정 정규화: 내가 남긴 방명록은 항상 꺼짐', () => {
    const n = normalizePresetConfig({ ...defaultPresetConfig(), guestbook: { ...defaultPresetConfig().guestbook, writtenByMe: true } });
    expect(n!.guestbook.writtenByMe).toBe(false);
    expect(normalizePresetConfig({ version: 2 })).toBeNull();
  });
});
