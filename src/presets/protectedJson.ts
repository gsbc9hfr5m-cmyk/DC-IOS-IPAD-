/**
 * 보호 목록 JSON 내보내기/가져오기 형식 (spec 2-4).
 */
import type { ProtectedItem } from '@/db/repos';

export const PROTECTED_FORMAT = 'dccleaner.protected';
export const PROTECTED_VERSION = 1;

export function serializeProtected(items: ProtectedItem[], exportedAt = new Date().toISOString()): string {
  return JSON.stringify({ format: PROTECTED_FORMAT, version: PROTECTED_VERSION, exportedAt, items }, null, 2);
}

const KEY_RE = /^(p|c):[0-9]+:[A-Za-z0-9]+$|^g:[0-9]+$/;

/** 형식이 틀린 항목은 버리고, 올바른 항목만 돌려준다. 파일 자체가 틀리면 null. */
export function parseProtected(text: string): Omit<ProtectedItem, 'addedAt'>[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as { format?: unknown; version?: unknown; items?: unknown };
  if (r.format !== PROTECTED_FORMAT || typeof r.version !== 'number' || r.version > PROTECTED_VERSION || !Array.isArray(r.items)) {
    return null;
  }
  const out: Omit<ProtectedItem, 'addedAt'>[] = [];
  for (const it of r.items) {
    if (typeof it !== 'object' || it === null) continue;
    const i = it as Record<string, unknown>;
    if (typeof i.key !== 'string' || !KEY_RE.test(i.key)) continue;
    out.push({
      key: i.key,
      kind: typeof i.kind === 'string' ? i.kind : i.key.startsWith('p:') ? 'post' : i.key.startsWith('c:') ? 'comment' : 'guestbook',
      title: typeof i.title === 'string' ? i.title.slice(0, 200) : '',
      galleryId: typeof i.galleryId === 'string' ? i.galleryId : null,
      writtenAt: typeof i.writtenAt === 'string' ? i.writtenAt : null,
    });
  }
  return out;
}
