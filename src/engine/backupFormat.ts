/**
 * 백업 레코드와 HTML 렌더링 (순수 함수). 파일 쓰기는 backup.ts.
 */
import { DC_HOSTS, DC_PATHS, VIEW_BASE } from '@/dc/config';
import type { PostView } from '@/dc/parsers';

import type { RunTarget } from './types';

export type BackupRecord = {
  key: string;
  kind: RunTarget['kind'];
  galleryId: string | null;
  galleryType: string | null;
  title: string;
  body: string;
  bodyHtml?: string;
  writtenAt: string;
  /** 원문(글) 또는 댓글이 달린 원글 링크 */
  url: string | null;
  author?: string;
  replies?: { author: string; body: string; writtenAt: string }[];
  views?: number | null;
  recommends?: number | null;
  /** 원문 조회에 실패해 갤로그 정보로만 만든 백업 */
  partial: boolean;
  backedUpAt: string;
};

export function postUrl(t: RunTarget): string | null {
  if (!t.galleryId || !t.gallery || !t.gallog) return null;
  return `${DC_HOSTS.mobile}${DC_PATHS.view(VIEW_BASE[t.gallery], t.galleryId, t.gallog.postNo)}`;
}

/** 백업 레코드 만들기 (순수 함수) */
export function buildBackupRecord(t: RunTarget, view: PostView | null, now = new Date().toISOString()): BackupRecord {
  const base = { key: t.key, kind: t.kind, galleryId: t.galleryId, galleryType: t.gallery, writtenAt: t.writtenAt, backedUpAt: now };
  if (t.kind === 'guestbook' && t.guestbook) {
    const g = t.guestbook;
    return {
      ...base,
      title: '',
      body: g.memoText,
      url: null,
      author: g.authorName || g.authorId,
      replies: g.replies.map((r) => ({ author: r.authorName || r.authorId, body: r.memoText, writtenAt: r.writtenAt })),
      partial: false,
    };
  }
  if (t.kind === 'comment' && t.gallog) {
    return { ...base, title: t.gallog.subject, body: t.gallog.memoText, bodyHtml: t.gallog.memoHtml, url: postUrl(t), partial: false };
  }
  // 글
  if (view) {
    return {
      ...base,
      title: view.title || t.title,
      body: view.bodyText,
      bodyHtml: view.bodyHtml,
      url: postUrl(t),
      views: view.views,
      recommends: view.recommends,
      partial: false,
    };
  }
  return { ...base, title: t.title, body: '', url: postUrl(t), partial: true };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const KIND = { post: '글', comment: '댓글', guestbook: '방명록' } as const;

/** 한 항목의 HTML 조각 (원문 HTML은 넣지 않고 텍스트만 이스케이프해서 넣는다 → 스크립트가 섞일 수 없다) */
export function renderBackupHtmlItem(r: BackupRecord): string {
  const meta = [KIND[r.kind], r.galleryId, r.writtenAt.replace('T', ' '), r.author, r.partial ? '부분 백업(원문 조회 실패)' : null]
    .filter(Boolean)
    .map((m) => esc(String(m)))
    .join(' · ');
  const replies = r.replies?.length
    ? `<ul>${r.replies.map((x) => `<li><b>${esc(x.author)}</b> ${esc(x.body)} <small>${esc(x.writtenAt)}</small></li>`).join('')}</ul>`
    : '';
  return `<article><h2>${esc(r.title || '(제목 없음)')}</h2><p class="m">${meta}</p><pre>${esc(r.body)}</pre>${replies}${
    r.url ? `<p class="m">${esc(r.url)}</p>` : ''
  }</article>\n`;
}

export function backupHtmlHeader(title: string): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(
    title,
  )}</title><style>body{font:16px -apple-system,system-ui;margin:16px;max-width:760px}article{border-bottom:1px solid #ccc;padding:12px 0}pre{white-space:pre-wrap;font:inherit}.m{color:#666;font-size:13px}@media(prefers-color-scheme:dark){body{background:#000;color:#eee}.m{color:#999}}</style></head><body><h1>${esc(
    title,
  )}</h1>\n`;
}

