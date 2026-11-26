/**
 * 디버그 기록과 크래시 로그 (spec 2-16). 기기 안의 파일에만 남기고 외부로 보내지 않는다.
 * - 디버그 모드가 켜져 있을 때만 요청/응답 요약을 남긴다 (경로, 상태 코드, 소요 시간, 파싱 요약).
 *   본문, 쿠키, 토큰, 비밀번호는 DcClient가 이미 마스킹한 값만 받는다.
 * - 앱 크래시/예외는 설정과 관계없이 crash.log에 남긴다.
 */
import { Directory, File, Paths } from 'expo-file-system';

import type { TraceEntry } from '@/dc/DcClient';
import { getSettings } from '@/settings/settingsStore';
import { maskObject } from '@/util/mask';

import { appendWithCap } from './ringLog';

const DEBUG_MAX = 512 * 1024;
const CRASH_MAX = 256 * 1024;

function logsDir(): Directory {
  const d = new Directory(Paths.document, 'logs');
  if (!d.exists) d.create({ intermediates: true });
  return d;
}

const cache: Record<string, string | undefined> = {};

function fileFor(name: string): File {
  const f = new File(logsDir(), name);
  if (!f.exists) f.create();
  return f;
}

function read(name: string): string {
  if (cache[name] === undefined) {
    try {
      cache[name] = fileFor(name).textSync();
    } catch {
      cache[name] = '';
    }
  }
  return cache[name]!;
}

function append(name: string, line: string, max: number) {
  try {
    const next = appendWithCap(read(name), line, max);
    cache[name] = next;
    fileFor(name).write(next);
  } catch {
    // 로그 실패가 앱 동작을 막으면 안 된다
  }
}

export function logTrace(t: TraceEntry): void {
  if (!getSettings().debugMode) return;
  append('debug.jsonl', JSON.stringify({ t: new Date(t.at).toISOString(), ...maskObject(t), at: undefined }), DEBUG_MAX);
}

export function logEvent(kind: string, detail: Record<string, unknown>): void {
  if (!getSettings().debugMode) return;
  append('debug.jsonl', JSON.stringify({ t: new Date().toISOString(), event: kind, ...maskObject(detail) }), DEBUG_MAX);
}

export function logCrash(error: unknown, fatal: boolean): void {
  const e = error instanceof Error ? error : new Error(String(error));
  append(
    'crash.log',
    JSON.stringify({ t: new Date().toISOString(), fatal, name: e.name, message: e.message.slice(0, 500), stack: e.stack?.slice(0, 2000) }),
    CRASH_MAX,
  );
}

export function readDebugLog(): string {
  return read('debug.jsonl');
}

export function readCrashLog(): string {
  return read('crash.log');
}

export function debugLogFileUri(name: 'debug.jsonl' | 'crash.log'): string {
  return fileFor(name).uri;
}

export function clearLogs(): void {
  for (const name of ['debug.jsonl', 'crash.log']) {
    cache[name] = '';
    try {
      fileFor(name).write('');
    } catch {
      // 무시
    }
  }
}

type ErrorUtilsLike = {
  getGlobalHandler: () => (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler: (h: (error: unknown, isFatal?: boolean) => void) => void;
};

/** 전역 예외 처리기: 로컬 파일에 기록한 뒤 원래 처리기로 넘긴다 */
export function installCrashHandler(): void {
  const eu = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (!eu) return;
  const prev = eu.getGlobalHandler();
  eu.setGlobalHandler((error, isFatal) => {
    logCrash(error, isFatal === true);
    prev(error, isFatal);
  });
}
