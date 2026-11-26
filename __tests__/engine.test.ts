import { DcError } from '@/dc/errors';
import type { BackupWriter } from '@/engine/backup';
import { buildBackupRecord, renderBackupHtmlItem } from '@/engine/backupFormat';
import { RunEngine, SPOT_CHECK_EVERY, type EngineClient } from '@/engine/RunEngine';
import type { RunItem, RunStore } from '@/engine/runRepo';
import { emptyCounts, type ItemStatus, type RunOptions, type RunStatus, type RunTarget } from '@/engine/types';
import type { ActionVerdict } from '@/dc/rules';
import { defaultPresetConfig } from '@/presets/types';
import { shouldLockOnReturn } from '@/security/lockLogic';
import { isDue, isMissed, lastOccurrence, nextOccurrence } from '@/schedule/schedule';
import { sanitizeSettings } from '@/settings/settingsStore';

// ───────────────────────── 메모리 저장소 ─────────────────────────

class MemStore implements RunStore {
  status: RunStatus = 'running';
  halt: string | null = null;
  items: RunItem[] = [];
  history: { key: string; result: ItemStatus; reason: string | null }[] = [];
  constructor(
    private readonly opts: RunOptions,
    targets: RunTarget[],
  ) {
    this.items = targets.map((t, seq) => ({ key: t.key, seq, target: t, status: 'pending', reason: null, attempts: 0 }));
  }
  createRun(): string {
    return 'r1';
  }
  getRun() {
    const counts = emptyCounts();
    this.items.forEach((i) => counts[i.status]++);
    return {
      id: 'r1',
      presetId: null,
      presetName: 't',
      trigger: 'manual' as const,
      status: this.status,
      startedAt: '',
      updatedAt: '',
      finishedAt: null,
      backupDir: null,
      haltReason: this.halt,
      counts,
      total: this.items.length,
    };
  }
  getOptions() {
    return this.opts;
  }
  setStatus(_id: string, s: RunStatus, reason: string | null = null) {
    this.status = s;
    this.halt = reason;
  }
  nextPending(_id: string, exclude: Set<string>) {
    return this.items.find((i) => i.status === 'pending' && !exclude.has(i.key)) ?? null;
  }
  updateItem(_id: string, key: string, status: ItemStatus, reason: string | null, d = 0) {
    const i = this.items.find((x) => x.key === key)!;
    i.status = status;
    i.reason = reason;
    i.attempts += d;
  }
  requeueFailed(_id: string, max: number) {
    let n = 0;
    this.items.forEach((i) => {
      if (i.status === 'failed' && i.attempts < max) {
        i.status = 'pending';
        n++;
      }
    });
    return n;
  }
  addHistory(_r: string, t: RunTarget, result: ItemStatus, reason: string | null) {
    this.history.push({ key: t.key, result, reason });
  }
  statusOf(key: string) {
    return this.items.find((i) => i.key === key)!.status;
  }
}

const opts = (over: Partial<RunOptions> = {}): RunOptions => ({
  presetConfig: defaultPresetConfig(),
  backupEnabled: true,
  backupRequired: true,
  backupFormat: 'json',
  failLimit: 5,
  strictVerify: false,
  concurrency: 1,
  ...over,
});

function postTarget(n: number, over: Partial<RunTarget> = {}): RunTarget {
  return {
    key: `p:100:${n}`,
    kind: 'post',
    title: `글 ${n}`,
    writtenAt: '2024-01-01T00:00:00',
    galleryId: 'programming',
    gallery: 'general',
    needsMetrics: false,
    replyCount: 0,
    gallog: {
      kind: 'post',
      gallery: 'general',
      typeCode: 'G',
      logNo: String(1000 + n),
      gallCode: '100',
      postNo: String(n),
      commentNo: null,
      subject: `글 ${n}`,
      memoHtml: '',
      memoText: '',
      writtenAt: '2024-01-01T00:00:00',
      isReply: false,
    },
    ...over,
  };
}

const view = { title: 't', bodyHtml: '<p>b</p>', bodyText: 'b', writtenAt: null, views: 10, recommends: 1 };

function setup(targets: RunTarget[], o: RunOptions = opts(), clientOver: Partial<EngineClient> = {}, protectedKeys: string[] = []) {
  const store = new MemStore(o, targets);
  const calls: string[] = [];
  const written: string[] = [];
  const deleted = new Set<string>();
  const notes: string[] = [];
  const client: EngineClient = {
    fetchPost: jest.fn(async (_g, _id, no: string) => {
      calls.push(`fetch:${no}`);
      return deleted.has(no) ? { status: 'deleted' as const } : { status: 'ok' as const, view };
    }),
    deleteGallogItem: jest.fn(async (logNo: string): Promise<ActionVerdict> => {
      calls.push(`del:${logNo}`);
      deleted.add(String(Number(logNo) - 1000));
      return { type: 'ok' };
    }),
    deleteGuestbook: jest.fn(async () => ({ type: 'ok' as const })),
    postHasComment: jest.fn(async () => false),
    listGuestbook: jest.fn(),
    ...clientOver,
  } as EngineClient;
  const writer: BackupWriter = {
    dir: 'mem://',
    write: (r) => {
      calls.push(`backup:${r.key}`);
      written.push(r.key);
    },
    bytes: () => 0,
    count: () => written.length,
  };
  const engine = new RunEngine({
    store,
    client,
    isProtected: (k) => protectedKeys.includes(k),
    ensureSession: jest.fn(async () => 'uid'),
    openWriter: () => writer,
    notify: (t, b) => notes.push(`${t}: ${b}`),
    sleep: async () => {},
  });
  return { store, engine, calls, written, notes, client };
}

describe('삭제 엔진: 순서와 안전 규칙', () => {
  it('백업 → 보호 검사 → 삭제 순서, 완료 알림', async () => {
    const { engine, calls, store, notes } = setup([postTarget(1), postTarget(2)]);
    expect(await engine.run('r1')).toBe('completed');
    expect(calls).toEqual(['fetch:1', 'backup:p:100:1', 'del:1001', 'fetch:2', 'backup:p:100:2', 'del:1002']);
    expect(store.items.every((i) => i.status === 'deleted')).toBe(true);
    expect(notes[0]).toContain('삭제 완료');
  });

  it('보호된 항목은 삭제 요청을 보내지 않는다', async () => {
    const { engine, calls, store } = setup([postTarget(1), postTarget(2)], opts(), {}, ['p:100:1']);
    await engine.run('r1');
    expect(calls.filter((c) => c.startsWith('del:'))).toEqual(['del:1002']);
    expect(store.statusOf('p:100:1')).toBe('protected');
  });

  it('백업 필수 모드: 백업에 실패하면 삭제하지 않는다', async () => {
    const { engine, calls, store } = setup([postTarget(1)], opts(), {
      fetchPost: jest.fn(async () => {
        throw new DcError('network', 'x');
      }),
    });
    await engine.run('r1');
    // 네트워크 실패 → 재시도 후 failed. 삭제 요청은 한 번도 없다
    expect(calls.some((c) => c.startsWith('del:'))).toBe(false);
    expect(store.statusOf('p:100:1')).toBe('failed');
  });

  it('추천수 조건을 넘으면 남긴다', async () => {
    const o = opts({ presetConfig: { ...defaultPresetConfig(), metrics: { maxRecommends: 0, maxViews: null } } });
    const { engine, store, calls } = setup([postTarget(1, { needsMetrics: true })], o);
    await engine.run('r1');
    expect(store.statusOf('p:100:1')).toBe('skipped');
    expect(calls.some((c) => c.startsWith('del:'))).toBe(false);
  });

  it('del_limit(매니저 차단 경고)은 건너뛴다', async () => {
    const { engine, store } = setup([postTarget(1)], opts(), {
      deleteGallogItem: jest.fn(async () => ({ type: 'skip' as const, reason: 'delLimit' as const, message: '공지' })),
    });
    await engine.run('r1');
    expect(store.statusOf('p:100:1')).toBe('skipped');
    expect(store.items[0]!.reason).toContain('매니저 차단');
  });

  it('빈 응답은 성공이 아니라 미확인', async () => {
    const { engine, store } = setup([postTarget(1)], opts(), { deleteGallogItem: jest.fn(async () => ({ type: 'unverified' as const, reason: 'emptyBody' as const })) });
    await engine.run('r1');
    expect(store.statusOf('p:100:1')).toBe('unverified');
  });
});

describe('삭제 엔진: 중단, 일시정지, 재개', () => {
  it('연속 실패가 한도에 닿으면 자동 일시정지 + 알림', async () => {
    const targets = Array.from({ length: 6 }, (_, i) => postTarget(i + 1));
    const { engine, store, notes } = setup(targets, opts({ failLimit: 3 }), {
      deleteGallogItem: jest.fn(async () => ({ type: 'fail' as const, message: '실패' })),
    });
    expect(await engine.run('r1')).toBe('paused');
    expect(store.items.filter((i) => i.status === 'failed')).toHaveLength(3);
    expect(notes.some((n) => n.includes('자동 일시정지'))).toBe(true);
  });

  it('구조 변경이 감지되면 즉시 중단(halted)하고 디버그 정보를 남긴다', async () => {
    const { engine, store, notes } = setup([postTarget(1), postTarget(2)], opts(), {
      deleteGallogItem: jest.fn(async () => {
        throw new DcError('structureChanged', '형식 다름', { endpoint: 'log-del' });
      }),
    });
    expect(await engine.run('r1')).toBe('halted');
    expect(store.halt).toContain('디시 구조가 바뀐 것 같습니다');
    expect(store.halt).toContain('log-del');
    expect(store.statusOf('p:100:1')).toBe('pending'); // 처리하지 않은 것으로 남는다
    expect(notes[0]).toContain('중단');
  });

  it('차단 의심이면 즉시 중단', async () => {
    const { engine } = setup([postTarget(1)], opts(), { deleteGallogItem: jest.fn(async () => Promise.reject(new DcError('blocked', '차단'))) });
    expect(await engine.run('r1')).toBe('halted');
  });

  it('429는 한 번 기다렸다 이어서, 연달아 오면 중단', async () => {
    let n = 0;
    const flaky = jest.fn(async (): Promise<ActionVerdict> => {
      n++;
      if (n === 1) throw new DcError('rateLimited', 'x', {}, 75_000);
      return { type: 'ok' };
    });
    const a = setup([postTarget(1)], opts({ backupEnabled: false }), { deleteGallogItem: flaky });
    expect(await a.engine.run('r1')).toBe('completed');
    const always = jest.fn(async () => Promise.reject(new DcError('rateLimited', 'x', {}, 75_000)));
    const b = setup([postTarget(1)], opts({ backupEnabled: false }), { deleteGallogItem: always });
    expect(await b.engine.run('r1')).toBe('halted');
    expect(b.store.halt).toContain('요청 한도');
  });

  it('캡챠가 필요하면 그 항목을 남겨 두고 일시정지', async () => {
    const { engine, store } = setup([postTarget(1)], opts(), { deleteGallogItem: jest.fn(async () => ({ type: 'captcha' as const })) });
    expect(await engine.run('r1')).toBe('paused');
    expect(store.statusOf('p:100:1')).toBe('pending');
  });

  it('체크포인트: 일시정지 후 재개하면 남은 것만 처리한다', async () => {
    const targets = Array.from({ length: 4 }, (_, i) => postTarget(i + 1));
    const { engine, store, calls } = setup(targets, opts({ backupEnabled: false }));
    // 첫 항목을 처리하는 도중 일시정지 요청
    (engine as unknown as { d: { onChange?: () => void } }).d.onChange = () => engine.requestPause();
    expect(await engine.run('r1')).toBe('paused');
    const doneFirst = store.items.filter((i) => i.status === 'deleted').length;
    expect(doneFirst).toBe(1);
    (engine as unknown as { d: { onChange?: () => void } }).d.onChange = undefined;
    expect(await engine.run('r1')).toBe('completed');
    expect(calls.filter((c) => c.startsWith('del:'))).toEqual(['del:1001', 'del:1002', 'del:1003', 'del:1004']);
  });

  it('주기적 검증에서 삭제가 안 된 것이 보이면 중단한다', async () => {
    const targets = Array.from({ length: SPOT_CHECK_EVERY }, (_, i) => postTarget(i + 1));
    // 삭제 응답은 ok지만 실제로는 지워지지 않는 상황
    const { engine } = setup(targets, opts({ backupEnabled: false }), {
      deleteGallogItem: jest.fn(async () => ({ type: 'ok' as const })),
      fetchPost: jest.fn(async () => ({ status: 'ok' as const, view })),
    });
    expect(await engine.run('r1')).toBe('halted');
  });

  it('세션이 만료되면 재로그인 후 같은 항목을 다시 시도한다', async () => {
    let first = true;
    const del = jest.fn(async (): Promise<ActionVerdict> => {
      if (first) {
        first = false;
        throw new DcError('sessionExpired', 'x');
      }
      return { type: 'ok' };
    });
    const { engine, store } = setup([postTarget(1)], opts({ backupEnabled: false }), { deleteGallogItem: del });
    expect(await engine.run('r1')).toBe('completed');
    expect(store.statusOf('p:100:1')).toBe('deleted');
  });
});

describe('백업 형식', () => {
  it('HTML은 텍스트를 이스케이프한다 (원문 HTML을 그대로 넣지 않음)', () => {
    const r = buildBackupRecord(postTarget(1), { ...view, title: '<script>x</script>', bodyText: 'a & b' });
    const html = renderBackupHtmlItem(r);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a &amp; b');
    expect(r.url).toBe('https://m.dcinside.com/board/programming/1');
  });

  it('원문을 못 읽으면 부분 백업 표시', () => {
    expect(buildBackupRecord(postTarget(1), null).partial).toBe(true);
  });
});

describe('스케줄', () => {
  const s = { enabled: true, weekdays: [1, 3], time: '03:00' }; // 월, 수
  const wed10 = new Date(2026, 10, 25, 10, 0); // 2026-11-25 수요일

  it('최근/다음 예정 시각', () => {
    expect(lastOccurrence(s, wed10)).toEqual(new Date(2026, 10, 25, 3, 0));
    expect(nextOccurrence(s, wed10)).toEqual(new Date(2026, 10, 30, 3, 0)); // 다음 월요일
  });

  it('실행할 차례 / 이미 실행함 / 놓침', () => {
    expect(isDue(s, null, wed10)).toBe(true);
    expect(isDue(s, new Date(2026, 10, 25, 4, 0).toISOString(), wed10)).toBe(false);
    expect(isMissed(s, null, wed10)).toBe(true);
    expect(isMissed(s, null, new Date(2026, 10, 25, 3, 30))).toBe(false); // 30분은 아직 놓친 게 아님
  });

  it('확인 이전의 예정 시각으로는 실행하지 않는다', () => {
    expect(isDue(s, null, wed10, new Date(2026, 10, 25, 9, 0).toISOString())).toBe(false);
  });

  it('꺼져 있으면 절대 실행하지 않는다', () => {
    expect(isDue({ ...s, enabled: false }, null, wed10)).toBe(false);
  });
});

describe('앱 잠금 / 설정', () => {
  it('재인증 지연', () => {
    expect(shouldLockOnReturn(0, 1000, 1000)).toBe(true);
    expect(shouldLockOnReturn(60, 0, 59_000)).toBe(false);
    expect(shouldLockOnReturn(60, 0, 60_000)).toBe(true);
    expect(shouldLockOnReturn(60, null, 99_999)).toBe(false);
  });

  it('가져온 설정값을 허용 범위로 자른다', () => {
    expect(sanitizeSettings({ requestDelaySec: 1, concurrency: 9, failLimit: 5, backupFormat: 'pdf', appLock: 'yes', lockDelaySec: 60 })).toEqual({
      failLimit: 5,
      lockDelaySec: 60,
    });
  });
});
