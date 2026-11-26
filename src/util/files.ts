/**
 * 파일 도우미 (expo-file-system SDK 58 File/Directory API).
 * - 내보내기: 앱 문서 폴더에 쓰고 iOS 공유 시트로 넘긴다 (파일 앱 / AirDrop).
 * - 가져오기: 시스템 파일 선택기 (File.pickFileAsync).
 * 외부 서버로는 아무것도 보내지 않는다.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { Share } from 'react-native';

export function exportsDir(): Directory {
  const dir = new Directory(Paths.document, 'exports');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export function writeTextFile(dir: Directory, name: string, text: string): File {
  const file = new File(dir, name);
  if (file.exists) file.delete();
  file.create();
  file.write(text);
  return file;
}

/** 파일 또는 폴더를 공유 시트로 내보낸다 */
export async function shareUri(uri: string, title?: string): Promise<void> {
  await Share.share({ url: uri, title });
}

/** JSON 파일 하나를 골라 텍스트로 읽는다. 취소하면 null. */
export async function pickJsonText(): Promise<string | null> {
  const picked = await File.pickFileAsync({ mimeTypes: ['application/json', 'public.json', 'public.text'] });
  if (picked.canceled) return null;
  return picked.result.text();
}

export function timestampForFile(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
