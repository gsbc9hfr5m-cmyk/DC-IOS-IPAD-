/**
 * 삭제 전 백업 파일 쓰기 (spec 2-5).
 * - 실행 단위 폴더: Documents/backups/<날짜-프리셋>/
 * - backup.jsonl: 한 줄에 한 항목 (중단돼도 그때까지 내용이 남는다)
 * - HTML 형식을 고르면 backup.html도 함께 쓴다 (사람이 읽는 용도)
 * - 인덱스는 SQLite backups 테이블에 기록한다.
 */
import { Directory, File, Paths } from 'expo-file-system';

import { backupHtmlHeader, renderBackupHtmlItem, type BackupRecord } from './backupFormat';

export type { BackupRecord } from './backupFormat';

// ───────────────────────── 파일 쓰기 ─────────────────────────

export interface BackupWriter {
  readonly dir: string | null;
  write(r: BackupRecord): void;
  /** 전체 바이트 수 */
  bytes(): number;
  count(): number;
}

export function backupsRoot(): Directory {
  const d = new Directory(Paths.document, 'backups');
  if (!d.exists) d.create({ intermediates: true });
  return d;
}

export function openBackupWriter(folderName: string, format: 'json' | 'html', title: string): BackupWriter {
  const dir = new Directory(backupsRoot(), folderName);
  if (!dir.exists) dir.create({ intermediates: true });
  const jsonl = new File(dir, 'backup.jsonl');
  if (!jsonl.exists) jsonl.create();
  const html = format === 'html' ? new File(dir, 'backup.html') : null;
  if (html && !html.exists) {
    html.create();
    html.write(backupHtmlHeader(title));
  }
  let n = 0;
  return {
    dir: dir.uri,
    write(r) {
      jsonl.write(`${JSON.stringify(r)}\n`, { append: true });
      html?.write(renderBackupHtmlItem(r), { append: true });
      n++;
    },
    bytes: () => (jsonl.size ?? 0) + (html?.size ?? 0),
    count: () => n,
  };
}

/** 백업 폴더 전체 용량 */
export function backupsTotalBytes(): number {
  return backupsRoot().size ?? 0;
}

export function deleteBackupDir(uri: string): void {
  const d = new Directory(uri);
  if (d.exists) d.delete();
}
