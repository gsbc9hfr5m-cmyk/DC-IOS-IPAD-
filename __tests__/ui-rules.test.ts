import { helpTexts } from '@/help/helpTexts';
import { ICONS, isOutlineSymbol } from '@/ui/icons';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { findFillUsages } = require('../tools/check-icons.js') as { findFillUsages: () => string[] };

describe('아이콘 규칙 (윤곽선 전용)', () => {
  it('ICONS에 fill 변형이 없다', () => {
    for (const name of Object.values(ICONS)) expect(isOutlineSymbol(name)).toBe(true);
  });

  it('isOutlineSymbol이 fill 변형을 걸러낸다', () => {
    expect(isOutlineSymbol('house.fill')).toBe(false);
    expect(isOutlineSymbol('circle.fill.badge.plus')).toBe(false);
    expect(isOutlineSymbol('fill')).toBe(false);
    expect(isOutlineSymbol('exclamationmark.circle')).toBe(true);
    expect(isOutlineSymbol('rectangle.portrait.and.arrow.forward')).toBe(true);
  });

  it('소스 전체에 .fill 심볼 문자열이 없다', () => {
    expect(findFillUsages()).toEqual([]);
  });
});

describe('도움말 문구', () => {
  it('모든 항목에 제목, 설명, 동작 설명이 있다', () => {
    for (const [id, t] of Object.entries(helpTexts)) {
      expect({ id, ok: t.title.length > 0 && t.what.length > 0 && t.effect.length > 0 }).toEqual({ id, ok: true });
    }
  });

  it('위험 기능은 risk로 표시된다', () => {
    for (const id of ['runCleaner', 'schedule', 'persistentMode', 'backupBeforeDelete'] as const) {
      expect(helpTexts[id].risk).toBe(true);
    }
  });
});
