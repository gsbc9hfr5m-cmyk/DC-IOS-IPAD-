#!/usr/bin/env node
// 앱 소스 전체에서 SF Symbol fill 변형(.fill)이 쓰였는지 검사한다 (spec-addenda B).
// 사용: npm run check:icons  (CI와 jest 테스트에서도 같은 로직을 쓴다)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'src');
// 'house.fill', "circle.fill.badge" 같은 문자열 리터럴
const FILL_RE = /['"`][a-z0-9.]*\.fill(\.[a-z0-9.]*)?['"`]/i;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(p);
  }
  return out;
}

function findFillUsages() {
  const hits = [];
  for (const file of walk(ROOT)) {
    fs.readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (FILL_RE.test(line)) hits.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
      });
  }
  return hits;
}

module.exports = { findFillUsages };

if (require.main === module) {
  const hits = findFillUsages();
  if (hits.length) {
    console.error('fill 아이콘 사용 금지:\n' + hits.join('\n'));
    process.exit(1);
  }
  console.log('OK: fill 아이콘 없음');
}
