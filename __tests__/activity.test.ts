import { scanKind } from '@/activity/scan';
import { buildTargets, runName } from '@/activity/targets';
import { DcError } from '@/dc/errors';
import { parseGallogList, type GallogItem } from '@/dc/parsers';
import { gallogKey } from '@/presets/filter';

import * as F from './dc/fixtures';

function page(items: Record<string, unknown>[], last: number, total = 0) {
  return parseGallogList(F.gallogList(items, { last_page: last, total }));
}

describe('갤로그 파서: 갤러리 이름', () => {
  it('gall_name을 읽고, 없으면 빈 문자열', () => {
    const p = page([F.gallogItem({ gall_name: '국내야구 &amp; 응원' }), F.gallogItem({ no: '2', pno: '2' })], 1);
    expect(p.items.map((i) => i.gallName)).toEqual(['국내야구 & 응원', '']);
  });
});

describe('scanKind (전체 불러오기)', () => {
  it('모든 페이지를 읽으며 페이지마다 저장하고, 끝나면 사라진 항목을 정리한다', async () => {
    const pages = [
      page([F.gallogItem({ no: '1', pno: '11' }), F.gallogItem({ no: '2', pno: '12' })], 2, 3),
      page([F.gallogItem({ no: '3', pno: '13' })], 2, 3),
    ];
    const calls: number[] = [];
    const upserts: number[] = [];
    let kept: Set<string> | null = null;
    const n = await scanKind('post', {
      client: {
        listGallog: async (_menu, p) => {
          calls.push(p);
          return pages[p - 1]!;
        },
      },
      sink: {
        upsertGallogItems: (_k, items) => upserts.push(items.length),
        removeItemsNotIn: (_k, keep) => {
          kept = keep;
          return 0;
        },
      },
    });
    expect(n).toBe(3);
    expect(calls).toEqual([1, 2]);
    expect(upserts).toEqual([2, 1]);
    expect(kept!.size).toBe(3);
  });

  it('도중에 실패하면 사라진 항목 정리를 하지 않는다 (지우지 않은 목록을 잃지 않음)', async () => {
    const remove = jest.fn();
    await expect(
      scanKind('post', {
        client: {
          listGallog: async (_m, p) => {
            if (p === 2) throw new DcError('blocked', '차단');
            return page([F.gallogItem()], 3);
          },
        },
        sink: { upsertGallogItems: () => {}, removeItemsNotIn: remove },
      }),
    ).rejects.toThrow('차단');
    expect(remove).not.toHaveBeenCalled();
  });

  it('요청 한도(429)면 기다렸다가 같은 페이지를 다시 읽는다', async () => {
    let first = true;
    const slept: number[] = [];
    const n = await scanKind('comment', {
      client: {
        listGallog: async () => {
          if (first) {
            first = false;
            throw new DcError('rateLimited', '한도', undefined, 1000);
          }
          return page([F.gallogItem({ type: 'R', cno: '55' })], 1);
        },
      },
      sink: { upsertGallogItems: () => {}, removeItemsNotIn: () => 0 },
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    expect(n).toBe(1);
    expect(slept).toEqual([1000]);
  });
});

describe('buildTargets (갤러리 선택 → 삭제 대상)', () => {
  const items = page(
    [
      F.gallogItem({ no: '1', pno: '11', wdate: '2024.05.01', subject: '새 글' }),
      F.gallogItem({ no: '2', pno: '12', wdate: '2023.01.01', subject: '옛 글' }),
      F.gallogItem({ no: '3', pno: '11', type: 'R', cno: '77', memo: '댓글 내용', wdate: '2024.02.01' }),
    ],
    1,
  ).items;
  const rows = items.map((item: GallogItem) => ({ key: gallogKey(item), item }));

  it('고른 종류만, 오래된 순으로, 보호 항목은 빼고', () => {
    const protectedKey = rows[0]!.key;
    const t = buildTargets(rows, ['post'], new Map([['G:79806', 'baseball_new']]), (k) => k === protectedKey);
    expect(t.map((x) => x.title)).toEqual(['옛 글']);
    expect(t[0]).toMatchObject({ kind: 'post', galleryId: 'baseball_new', gallery: 'general', needsMetrics: false });
  });

  it('글+댓글이면 둘 다, 같은 항목은 한 번만', () => {
    const t = buildTargets([...rows, rows[2]!], ['post', 'comment'], new Map(), () => false);
    expect(t.map((x) => x.kind)).toEqual(['post', 'comment', 'post']);
    expect(t[1]!.title).toBe('댓글 내용');
    expect(t[1]!.galleryId).toBeNull();
  });

  it('실행 이름', () => {
    expect(runName(['국내야구'], ['post'])).toBe('국내야구 · 글');
    expect(runName(['국내야구', '주식', '싱글벙글'], ['post', 'comment'])).toBe('국내야구 외 2곳 · 글+댓글');
    expect(runName(['주식'], ['comment'])).toBe('주식 · 댓글');
  });
});
