/**
 * 갤러리 선택 → 삭제 대상 (순수 함수, 테스트 대상).
 * - 보호 목록 항목은 넣지 않는다 (엔진도 실행 직전에 한 번 더 확인한다).
 * - 오래된 것부터 지운다.
 */
import type { GallogItem } from '@/dc/parsers';
import type { RunTarget } from '@/engine/types';

export type DeleteKinds = ('post' | 'comment')[];

export function buildTargets(
  rows: { key: string; item: GallogItem }[],
  kinds: DeleteKinds,
  galleryIds: Map<string, string>,
  isProtected: (key: string) => boolean,
): RunTarget[] {
  const seen = new Set<string>();
  return rows
    .filter(({ key, item }) => kinds.includes(item.kind) && !isProtected(key) && !seen.has(key) && (seen.add(key), true))
    .sort((a, b) => a.item.writtenAt.localeCompare(b.item.writtenAt))
    .map(({ key, item }) => ({
      key,
      kind: item.kind,
      title: item.kind === 'post' ? item.subject : item.memoText || item.subject,
      writtenAt: item.writtenAt,
      galleryId: galleryIds.get(`${item.typeCode}:${item.gallCode}`) ?? null,
      gallery: item.gallery,
      needsMetrics: false,
      replyCount: 0,
      gallog: item,
    }));
}

/** 실행 이름: "국내야구 외 2곳 · 글+댓글" */
export function runName(galleryNames: string[], kinds: DeleteKinds): string {
  const what = kinds.length === 2 ? '글+댓글' : kinds[0] === 'post' ? '글' : '댓글';
  const first = galleryNames[0] ?? '갤러리';
  const where = galleryNames.length > 1 ? `${first} 외 ${galleryNames.length - 1}곳` : first;
  return `${where} · ${what}`;
}
