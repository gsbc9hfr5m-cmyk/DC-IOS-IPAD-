import { CaptchaService, withCacheBuster, type CaptchaDeps, type ManualRequest } from '@/captcha/CaptchaService';
import { createSolver, SolverError, type CaptchaSolver, type JsonPost } from '@/captcha/solvers';
import { arrayBufferToBase64 } from '@/util/base64';

const noSleep = async () => {};

function recordingPost(replies: unknown[]): { post: JsonPost; calls: { url: string; body: any }[] } {
  const calls: { url: string; body: any }[] = [];
  const queue = [...replies];
  return {
    calls,
    post: async (url, body) => {
      calls.push({ url, body });
      if (!queue.length) throw new Error('unexpected call ' + url);
      return queue.shift();
    },
  };
}

describe('외부 캡챠 서비스', () => {
  it('2Captcha: createTask → getTaskResult 폴링 → solution.text', async () => {
    const { post, calls } = recordingPost([
      { errorId: 0, taskId: 42 },
      { errorId: 0, status: 'processing' },
      { errorId: 0, status: 'ready', solution: { text: ' ab12 ' } },
    ]);
    const solver = createSolver('2captcha', 'KEY', { post, sleep: noSleep });
    expect(await solver.solveImage('BASE64')).toBe('ab12');
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.2captcha.com/createTask',
      'https://api.2captcha.com/getTaskResult',
      'https://api.2captcha.com/getTaskResult',
    ]);
    expect(calls[0]!.body).toEqual({ clientKey: 'KEY', task: { type: 'ImageToTextTask', body: 'BASE64', case: false, phrase: false } });
    expect(calls[1]!.body).toEqual({ clientKey: 'KEY', taskId: 42 });
  });

  it('Anti-Captcha는 languagePool을 task에 넣는다', async () => {
    const { post, calls } = recordingPost([{ errorId: 0, taskId: 1 }, { errorId: 0, status: 'ready', solution: { text: 'x' } }]);
    await createSolver('anticaptcha', 'K', { post, sleep: noSleep }).solveImage('B');
    expect(calls[0]!.url).toBe('https://api.anti-captcha.com/createTask');
    expect(calls[0]!.body.task.languagePool).toBe('en');
  });

  it('CapSolver는 createTask 한 번으로 끝난다', async () => {
    const { post, calls } = recordingPost([{ errorId: 0, status: 'ready', solution: { text: 'zz9' } }]);
    expect(await createSolver('capsolver', 'K', { post, sleep: noSleep }).solveImage('B')).toBe('zz9');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.task).toEqual({ type: 'ImageToTextTask', body: 'B', module: 'common' });
  });

  it.each([
    ['ERROR_KEY_DOES_NOT_EXIST', 'invalidKey'],
    ['ERROR_KEY_DENIED_ACCESS', 'invalidKey'],
    ['ERROR_ZERO_BALANCE', 'zeroBalance'],
    ['ERROR_CAPTCHA_UNSOLVABLE', 'unsolvable'],
    ['ERROR_NO_SLOT_AVAILABLE', 'busy'],
    ['ERROR_WHATEVER', 'unknown'],
  ])('오류 코드 %s → %s', async (errorCode, expected) => {
    const { post } = recordingPost([{ errorId: 1, errorCode }]);
    await expect(createSolver('2captcha', 'K', { post, sleep: noSleep }).solveImage('B')).rejects.toMatchObject({ code: expected });
  });

  it('시간이 지나도 준비되지 않으면 timeout', async () => {
    let t = 0;
    const post: JsonPost = async (url) => (url.endsWith('createTask') ? { errorId: 0, taskId: 1 } : { errorId: 0, status: 'processing' });
    const solver = createSolver('2captcha', 'K', { post, sleep: async (ms) => void (t += ms), now: () => t, pollMs: 5000, timeoutMs: 20000 });
    await expect(solver.solveImage('B')).rejects.toMatchObject({ code: 'timeout' });
  });

  it('잔액 조회', async () => {
    const { post } = recordingPost([{ errorId: 0, balance: 1.5 }]);
    expect(await createSolver('capsolver', 'K', { post }).getBalance()).toBe(1.5);
  });
});

describe('CaptchaService', () => {
  const challenge = { context: 'delete' as const, imageUrl: 'https://m.dcinside.com/captcha/code?id=log_del_botchk&dccode=R1&type=D', randCode: 'R1' };

  function deps(over: Partial<CaptchaDeps> & { solver?: CaptchaSolver; manual?: string | null }) {
    const notes: string[] = [];
    const manualReqs: ManualRequest[] = [];
    const fetched: string[] = [];
    const d: CaptchaDeps = {
      getMode: () => 'auto',
      getSolverId: () => '2captcha',
      getApiKey: async () => 'KEY',
      createSolver: () => over.solver ?? { id: '2captcha', solveImage: async () => 'auto1', getBalance: async () => 1 },
      fetchImageBase64: async (url) => {
        fetched.push(url);
        return 'IMG';
      },
      askManual: async (req) => {
        manualReqs.push(req);
        return over.manual === undefined ? 'man1' : over.manual;
      },
      notify: (title, body) => notes.push(`${title}|${body}`),
      ...over,
    };
    return { d, notes, manualReqs, fetched };
  }

  it('자동 성공', async () => {
    const { d, manualReqs } = deps({});
    expect(await new CaptchaService(d).solve(challenge)).toEqual({ answer: { code: 'auto1', randCode: 'R1' }, via: 'auto' });
    expect(manualReqs).toHaveLength(0);
  });

  it('자동 실패(잔액 부족) → 알림 + 수동 폴백', async () => {
    const failing: CaptchaSolver = {
      id: '2captcha',
      solveImage: async () => {
        throw new SolverError('zeroBalance', '캡챠 서비스 잔액이 없습니다.');
      },
      getBalance: async () => 0,
    };
    const { d, notes, manualReqs } = deps({ solver: failing });
    expect(await new CaptchaService(d).solve(challenge)).toEqual({ answer: { code: 'man1', randCode: 'R1' }, via: 'manual' });
    expect(notes[0]).toContain('잔액');
    expect(manualReqs[0]!.fallbackReason).toContain('잔액');
  });

  it('API 키가 없으면 수동으로', async () => {
    const { d, manualReqs } = deps({ getApiKey: async () => null });
    expect((await new CaptchaService(d).solve(challenge))?.via).toBe('manual');
    expect(manualReqs[0]!.fallbackReason).toContain('API 키');
  });

  it('수동 모드, 취소, 빈 입력', async () => {
    expect((await new CaptchaService(deps({ getMode: () => 'manual' }).d).solve(challenge))?.via).toBe('manual');
    expect(await new CaptchaService(deps({ getMode: () => 'manual', manual: null }).d).solve(challenge)).toBeNull();
    expect(await new CaptchaService(deps({ getMode: () => 'manual', manual: '  ' }).d).solve(challenge)).toBeNull();
  });

  it('forceManual이면 자동 모드여도 수동', async () => {
    const { d, manualReqs } = deps({});
    expect((await new CaptchaService(d).solve(challenge, { forceManual: true }))?.via).toBe('manual');
    expect(manualReqs).toHaveLength(1);
  });

  it('새 이미지는 캐시 무효화 파라미터를 붙여 받는다', async () => {
    const { d, manualReqs, fetched } = deps({ getMode: () => 'manual' });
    await new CaptchaService(d).solve(challenge);
    await manualReqs[0]!.reload();
    expect(fetched[1]).toMatch(/type=D&v=\d+$/);
    expect(withCacheBuster('https://x/a?b=1&v=111', 222)).toBe('https://x/a?b=1&v=222');
    expect(withCacheBuster('https://x/a', 5)).toBe('https://x/a?v=5');
  });
});

describe("base64", () => {
  it("RFC 4648 테스트 벡터", () => {
    const cases: [string, string][] = [["", ""], ["f", "Zg=="], ["fo", "Zm8="], ["foo", "Zm9v"], ["foob", "Zm9vYg=="], ["fooba", "Zm9vYmE="], ["foobar", "Zm9vYmFy"]];
    for (const [plain, b64] of cases) {
      const bytes = new TextEncoder().encode(plain);
      expect(arrayBufferToBase64(bytes.buffer as ArrayBuffer)).toBe(b64);
    }
  });
});
