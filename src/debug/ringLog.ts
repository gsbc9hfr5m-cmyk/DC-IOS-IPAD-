/**
 * 크기 상한이 있는 로그 (spec 2-16: 크기 상한과 자동 순환). 순수 로직.
 * 상한을 넘으면 오래된 줄부터 버려서 상한의 절반까지 줄인다.
 */
export function appendWithCap(existing: string, line: string, maxBytes: number): string {
  const next = existing + line + (line.endsWith('\n') ? '' : '\n');
  if (byteLength(next) <= maxBytes) return next;
  const lines = next.split('\n').filter(Boolean);
  let size = 0;
  const kept: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    size += byteLength(lines[i]!) + 1;
    if (size > maxBytes / 2) break;
    kept.unshift(lines[i]!);
  }
  return kept.length ? `${kept.join('\n')}\n` : '';
}

export function byteLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}
