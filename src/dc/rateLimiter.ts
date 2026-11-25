/**
 * 디시 요청 예산 관리 (spec 2-6, dc-protocol §6-1).
 * - 모든 요청(목록, 삭제, 원문 조회)이 같은 카운터를 쓰므로 하나의 리미터를 공유한다.
 * - 요청 간 최소 간격 + 랜덤 지터
 * - 응답의 x-ratelimit-remaining이 reserve 이하이면 창이 끝날 때까지 대기
 * - 429를 받으면 쿨다운 후 지수 백오프
 */
import { RATE_LIMIT } from './config';

export type Clock = { now: () => number; sleep: (ms: number) => Promise<void> };

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export type RateLimiterOptions = {
  minIntervalMs?: number;
  jitterMs?: number;
  windowMs?: number;
  reserve?: number;
  cooldownMs?: number;
  maxBackoffMs?: number;
  random?: () => number;
};

export class RateLimiter {
  private lastAt = -Infinity;
  private blockedUntil = 0;
  private strikes = 0;
  private readonly o: Required<RateLimiterOptions>;

  constructor(
    private readonly clock: Clock = realClock,
    opts: RateLimiterOptions = {},
  ) {
    this.o = {
      minIntervalMs: opts.minIntervalMs ?? RATE_LIMIT.minIntervalMs,
      jitterMs: opts.jitterMs ?? RATE_LIMIT.jitterMs,
      windowMs: opts.windowMs ?? RATE_LIMIT.windowMs,
      reserve: opts.reserve ?? RATE_LIMIT.reserve,
      cooldownMs: opts.cooldownMs ?? RATE_LIMIT.cooldownMs,
      maxBackoffMs: opts.maxBackoffMs ?? 15 * 60_000,
      random: opts.random ?? Math.random,
    };
  }

  /** 다음 요청을 보내도 되는 시각까지 기다린다. */
  async acquire(): Promise<void> {
    const now = this.clock.now();
    const interval = this.o.minIntervalMs + Math.floor(this.o.random() * this.o.jitterMs);
    const readyAt = Math.max(this.lastAt + interval, this.blockedUntil);
    if (readyAt > now) await this.clock.sleep(readyAt - now);
    this.lastAt = this.clock.now();
  }

  /** 응답 헤더를 반영한다. */
  observe(headers: Record<string, string>): void {
    const remaining = Number(headers['x-ratelimit-remaining']);
    if (Number.isFinite(remaining) && remaining <= this.o.reserve) {
      // 창 끝을 모르므로 보수적으로 창 하나만큼 쉰다
      this.blockedUntil = Math.max(this.blockedUntil, this.clock.now() + this.o.windowMs);
    }
    if (Number.isFinite(remaining) && remaining > this.o.reserve) this.strikes = 0;
  }

  /** 429를 받았을 때. 반환값은 이번 쿨다운 길이(ms). */
  penalize(): number {
    this.strikes += 1;
    const wait = Math.min(this.o.cooldownMs * 2 ** (this.strikes - 1), this.o.maxBackoffMs);
    this.blockedUntil = Math.max(this.blockedUntil, this.clock.now() + wait);
    return wait;
  }

  /** 다음 요청까지 남은 시간 (UI 표시용) */
  msUntilReady(): number {
    return Math.max(0, Math.max(this.lastAt + this.o.minIntervalMs, this.blockedUntil) - this.clock.now());
  }
}
