/**
 * 삭제 엔진 (spec 2-6, 2-7). 수동, 스케줄, 단축어 실행이 모두 이 엔진을 쓴다.
 *
 * 항목마다 반드시 이 순서를 지킨다 (spec 5절):
 *   (실행 전 확인은 호출하는 쪽에서) → 백업 → 보호 검사 → 삭제 → 응답 검증
 *
 * - 체크포인트: 항목 상태를 매번 SQLite에 기록한다. 앱이 꺼져도 pending부터 이어서 처리한다.
 * - 연속 실패가 failLimit에 닿으면 자동 일시정지한다.
 * - 차단/구조 변경이 감지되면 즉시 중단(halted)한다.
 * - 삭제 응답이 성공이어도 검증 결과 남아 있으면 즉시 중단한다 (오삭제/오판 방지).
 */
import type { DcClient } from '@/dc/DcClient';
import { DcError, isDcError } from '@/dc/errors';
import type { PostView } from '@/dc/parsers';
import { metricsAllowDelete } from '@/presets/filter';

import type { BackupWriter } from './backup';
import { buildBackupRecord } from './backupFormat';
import type { RunItem, RunStore } from './runRepo';
import type { ItemStatus, RunOptions, RunStatus } from './types';

export const MAX_ATTEMPTS = 3;
/** 엄격 검증이 꺼져 있어도 이 간격마다 한 번은 실제로 사라졌는지 확인한다 */
export const SPOT_CHECK_EVERY = 10;
/** 429 대기가 이보다 길면 기다리지 않고 멈춘다 */
const MAX_INLINE_WAIT_MS = 5 * 60_000;

export type EngineClient = Pick<DcClient, 'deleteGallogItem' | 'deleteGuestbook' | 'fetchPost' | 'postHasComment' | 'listGuestbook'>;

export type EngineDeps = {
  store: RunStore;
  client: EngineClient;
  isProtected: (key: string) => boolean;
  ensureSession: () => Promise<unknown>;
  openWriter: (runId: string, opts: RunOptions) => BackupWriter | null;
  notify: (title: string, body: string) => void;
  /** 삭제 확정된 항목을 수집 캐시에서 지운다 */
  onDeleted?: (key: string) => void;
  onChange?: (runId: string, current: string | null) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

type ItemOutcome = { status: Exclude<ItemStatus, 'pending'>; reason: string | null };

class PauseSignal extends Error {}

export class RunEngine {
  private stop: 'pause' | 'cancel' | null = null;
  private activeRunId: string | null = null;
  private consecutiveFailures = 0;
  private consecutiveRateLimits = 0;
  private deletedSinceCheck = 0;

  constructor(private readonly d: EngineDeps) {}

  get running(): string | null {
    return this.activeRunId;
  }

  requestPause() {
    this.stop = 'pause';
  }

  requestCancel() {
    this.stop = 'cancel';
  }

  /**
   * 실행을 진행한다. 끝나거나 멈출 때까지, 또는 deadline(ms epoch)까지 돈다 (백그라운드 조각 실행).
   * 반환값은 이번 호출이 끝난 시점의 상태.
   */
  async run(runId: string, opts: { deadline?: number } = {}): Promise<RunStatus> {
    if (this.activeRunId) throw new Error('이미 실행 중입니다.');
    const options = this.d.store.getOptions(runId);
    if (!options) throw new Error('실행 정보를 찾을 수 없습니다.');
    this.activeRunId = runId;
    this.stop = null;
    this.consecutiveFailures = 0;
    this.consecutiveRateLimits = 0;
    this.d.store.setStatus(runId, 'running');
    const now = this.d.now ?? Date.now;
    const writer = options.backupEnabled ? this.d.openWriter(runId, options) : null;
    const inFlight = new Set<string>();

    const worker = async (): Promise<void> => {
      for (;;) {
        if (this.stop || (opts.deadline && now() >= opts.deadline)) return;
        const item = this.d.store.nextPending(runId, inFlight);
        if (!item) return;
        inFlight.add(item.key);
        try {
          this.d.onChange?.(runId, item.target.title);
          const out = await this.processWithRecovery(runId, item, options, writer);
          this.d.store.updateItem(runId, item.key, out.status, out.reason, out.status === 'failed' ? 1 : 0);
          // 실패는 재시도 대상이라 마지막 시도에서만 이력에 남긴다
          if (out.status !== 'failed' || item.attempts + 1 >= MAX_ATTEMPTS) this.d.store.addHistory(runId, item.target, out.status, out.reason);
          if (out.status === 'deleted') this.d.onDeleted?.(item.key);
          this.trackFailures(out, options);
        } finally {
          inFlight.delete(item.key);
        }
      }
    };

    let final: RunStatus = 'running';
    try {
      for (;;) {
        await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency, 3)) }, worker));
        if (this.stop || (opts.deadline && now() >= opts.deadline)) break;
        // 재시도 큐: 실패 항목을 한 번 더 시도한다
        if (this.d.store.requeueFailed(runId, MAX_ATTEMPTS) > 0) continue;
        break;
      }
      if (this.stop === 'cancel') final = 'cancelled';
      else if (this.stop === 'pause') final = 'paused';
      else if (!this.d.store.nextPending(runId, new Set())) final = 'completed';
      if (final !== 'running') this.d.store.setStatus(runId, final, final === 'paused' ? this.pauseReason : null);
      if (final === 'completed') this.notifyDone(runId);
    } catch (e) {
      final = this.handleHalt(runId, e);
    } finally {
      this.activeRunId = null;
      this.pauseReason = null;
      this.d.onChange?.(runId, null);
    }
    return final;
  }

  private pauseReason: string | null = null;

  private pause(reason: string): never {
    this.pauseReason = reason;
    this.stop = 'pause';
    throw new PauseSignal(reason);
  }

  private trackFailures(out: ItemOutcome, o: RunOptions) {
    if (out.status === 'failed' || out.status === 'unverified') this.consecutiveFailures++;
    else this.consecutiveFailures = 0;
    if (this.consecutiveFailures >= o.failLimit && !this.stop) {
      this.pauseReason = `연속 ${this.consecutiveFailures}회 실패해서 자동으로 일시정지했습니다.`;
      this.stop = 'pause';
      this.d.notify('자동 일시정지', this.pauseReason);
    }
  }

  private handleHalt(runId: string, e: unknown): RunStatus {
    if (e instanceof PauseSignal) {
      this.d.store.setStatus(runId, 'paused', e.message);
      this.d.notify('작업이 멈췄습니다', e.message);
      return 'paused';
    }
    const msg = isDcError(e)
      ? e.code === 'structureChanged'
        ? `디시 구조가 바뀐 것 같습니다. 앱 업데이트가 필요할 수 있습니다. (${e.message})`
        : e.code === 'rateLimited'
          ? `디시 요청 한도에 걸렸습니다. 약 ${Math.ceil((e.retryAfterMs ?? 600_000) / 60_000)}분 뒤에 이어서 실행하세요.`
          : e.message
      : `예상하지 못한 오류: ${String(e).slice(0, 120)}`;
    const debug = isDcError(e) ? JSON.stringify({ code: e.code, ...e.debug }) : '';
    this.d.store.setStatus(runId, 'halted', debug ? `${msg}\n${debug}` : msg);
    this.d.notify('삭제를 중단했습니다', msg);
    return 'halted';
  }

  private notifyDone(runId: string) {
    const r = this.d.store.getRun(runId);
    if (!r) return;
    const c = r.counts;
    this.d.notify('삭제 완료', `삭제 ${c.deleted} · 실패 ${c.failed} · 건너뜀 ${c.skipped} · 보호됨 ${c.protected}${c.unverified ? ` · 미확인 ${c.unverified}` : ''}`);
  }

  /** 세션 만료와 일시적 요청 한도를 처리하며 한 항목을 진행한다 */
  private async processWithRecovery(runId: string, item: RunItem, o: RunOptions, writer: BackupWriter | null): Promise<ItemOutcome> {
    let sessionRetried = false;
    for (;;) {
      try {
        const out = await this.process(item, o, writer);
        this.consecutiveRateLimits = 0;
        return out;
      } catch (e) {
        if (!isDcError(e)) throw e;
        if (e.code === 'sessionExpired' && !sessionRetried) {
          sessionRetried = true;
          await this.d.ensureSession(); // 실패하면 sessionExpired를 던지고 아래에서 중단된다
          continue;
        }
        if (e.code === 'sessionExpired') this.pause('로그인이 필요합니다. 다시 로그인한 뒤 이어서 실행하세요.');
        if (e.code === 'rateLimited') {
          this.consecutiveRateLimits++;
          const wait = e.retryAfterMs ?? 75_000;
          if (this.consecutiveRateLimits >= 2 || wait > MAX_INLINE_WAIT_MS) throw e; // 반복되면 중단 + 쿨다운 안내
          this.d.onChange?.(runId, `요청 한도로 ${Math.ceil(wait / 1000)}초 대기 중`);
          await (this.d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(wait);
          continue;
        }
        if (e.code === 'network') return { status: 'failed', reason: e.message };
        throw e; // blocked / structureChanged / notOwner → 중단
      }
    }
  }

  private async process(item: RunItem, o: RunOptions, writer: BackupWriter | null): Promise<ItemOutcome> {
    const t = item.target;
    const c = this.d.client;

    // 0) 원문 조회: 글 백업 내용과 추천수/조회수 조건 확인용
    let view: PostView | null = null;
    let originalGone = false;
    if (t.kind === 'post' && (o.backupEnabled || t.needsMetrics)) {
      if (t.gallog && t.galleryId && t.gallery) {
        const r = await c.fetchPost(t.gallery, t.galleryId, t.gallog.postNo);
        if (r.status === 'deleted') originalGone = true;
        else view = r.view;
      } else if (t.needsMetrics) {
        return { status: 'skipped', reason: '갤러리 정보를 몰라 추천수/조회수 조건을 확인하지 못했습니다.' };
      }
    }
    if (t.needsMetrics && !originalGone && !metricsAllowDelete(o.presetConfig.metrics, view?.views ?? null, view?.recommends ?? null)) {
      return { status: 'skipped', reason: '추천수/조회수 조건으로 남겼습니다.' };
    }

    // 1) 백업
    if (o.backupEnabled) {
      try {
        if (!writer) throw new Error('백업 폴더를 열지 못했습니다.');
        const record = buildBackupRecord(t, view);
        // 원글이 이미 사라진 경우는 더 잃을 내용이 없으므로 부분 백업을 허용한다
        if (record.partial && o.backupRequired && !originalGone) return { status: 'skipped', reason: '백업 실패로 스킵 (원문을 읽지 못함)' };
        writer.write(record);
      } catch {
        if (o.backupRequired) return { status: 'skipped', reason: '백업 실패로 스킵' };
      }
    }

    // 2) 보호 검사 (실행 직전에 다시 확인: 실행 중에 보호한 항목도 지키기 위해)
    if (this.d.isProtected(t.key)) return { status: 'protected', reason: '보호 목록' };

    // 3) 삭제
    const verdict =
      t.kind === 'guestbook'
        ? await c.deleteGuestbook(t.guestbook?.no ?? t.key.slice(2), t.replyCount > 0)
        : await c.deleteGallogItem(t.gallog?.logNo ?? '');

    // 4) 응답 검증
    switch (verdict.type) {
      case 'ok': {
        this.deletedSinceCheck++;
        if (o.strictVerify || this.deletedSinceCheck >= SPOT_CHECK_EVERY) {
          this.deletedSinceCheck = 0;
          const stillThere = await this.stillExists(item);
          if (stillThere === true) {
            throw new DcError('structureChanged', '삭제 응답은 성공이었지만 실제로는 남아 있습니다.', { key: t.key });
          }
        }
        return { status: 'deleted', reason: originalGone ? '원글이 이미 없어 갤로그 기록만 정리했습니다.' : null };
      }
      case 'unverified':
        return { status: 'unverified', reason: verdict.reason === 'emptyBody' ? '빈 응답 (이미 삭제됐을 수 있음)' : '응답에 결과가 없음' };
      case 'captcha':
        return this.pause('삭제에 캡챠가 필요합니다. 디시에서 한 번 직접 삭제해 캡챠를 통과한 뒤 이어서 실행하세요.');
      case 'skip':
        return {
          status: 'skipped',
          reason:
            verdict.reason === 'delLimit'
              ? `말머리 삭제 제한 (삭제하면 매니저 차단): ${verdict.message}`
              : verdict.reason === 'commentNoti'
                ? '공지글 댓글 (5분 안에 지우면 매니저 차단)'
                : `권한 없음: ${verdict.message}`,
        };
      case 'fail':
        return { status: 'failed', reason: verdict.message };
    }
  }

  /** 실제로 아직 남아 있는가. 확인할 수 없으면 null */
  private async stillExists(item: RunItem): Promise<boolean | null> {
    const t = item.target;
    const c = this.d.client;
    if (t.kind === 'post' && t.gallog && t.galleryId && t.gallery) {
      return (await c.fetchPost(t.gallery, t.galleryId, t.gallog.postNo)).status !== 'deleted';
    }
    if (t.kind === 'comment' && t.gallog?.commentNo && t.galleryId && t.gallery) {
      return c.postHasComment(t.gallery, t.galleryId, t.gallog.postNo, t.gallog.commentNo);
    }
    if (t.kind === 'guestbook' && t.guestbook) {
      const page = await c.listGuestbook(t.guestbook.year, 1);
      if (page.lastPage > 1) return null;
      return page.items.some((g) => g.no === t.guestbook!.no);
    }
    return null;
  }
}
