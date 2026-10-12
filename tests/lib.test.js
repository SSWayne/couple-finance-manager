import { describe, it, expect } from 'vitest';
import { addMonthsClamped, isValidDateString, fileTimestamp } from '../src/lib/date.js';
import { parseMoneyInput, formatMoney, formatPercent } from '../src/lib/money.js';
import { equalShares, ratioShares, computeAdvance, netAdvances } from '../src/domain/split.js';
import { isValidId, newId } from '../src/lib/id.js';

describe('日期', () => {
  it('1/31 每月 → 2/28（閏年 2/29）', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonthsClamped('2026-01-31', 2, 31)).toBe('2026-03-31');
    expect(addMonthsClamped('2026-12-15', 1)).toBe('2027-01-15');
  });
  it('驗證日期字串', () => {
    expect(isValidDateString('2026-02-29')).toBe(false);
    expect(isValidDateString('2028-02-29')).toBe(true);
    expect(isValidDateString('2026-13-01')).toBe(false);
  });
  it('檔名時間戳', () => {
    expect(fileTimestamp(new Date(2026, 9, 12, 8, 5, 9))).toBe('20261012-080509');
  });
});

describe('金額', () => {
  it('解析使用者輸入', () => {
    expect(parseMoneyInput('1,234')).toBe(1234);
    expect(parseMoneyInput('12.5')).toBeNull();
    expect(parseMoneyInput('abc')).toBeNull();
    expect(parseMoneyInput('99999999999999999999')).toBeNull();
  });
  it('格式化', () => {
    expect(formatMoney(1234567)).toBe('$1,234,567');
    expect(formatMoney(-500)).toBe('-$500');
    expect(formatPercent(1, 0)).toBe('不適用');
  });
});

describe('分攤與代墊', () => {
  it('50/50 零頭給付款人', () => {
    expect(equalShares(101, 'member-self')).toEqual({ 'member-self': 51, 'member-partner': 50 });
    expect(equalShares(101, 'member-partner')).toEqual({ 'member-partner': 51, 'member-self': 50 });
  });
  it('自訂比例零頭給付款人', () => {
    expect(ratioShares(1000, 'member-self', { 'member-self': 66.67, 'member-partner': 33.33 })).toEqual({ 'member-self': 667, 'member-partner': 333 });
    expect(ratioShares(1000, 'member-self', { 'member-self': 50, 'member-partner': 40 })).toBeNull();
  });
  it('幫對方付個人支出 = 全額代墊；共同支出代墊 = 對方負擔', () => {
    expect(computeAdvance({ type: 'expense', amount: 800, memberId: 'member-self', ownershipType: 'personal', ownerMemberId: 'member-partner' }))
      .toEqual({ creditorId: 'member-self', debtorId: 'member-partner', amount: 800 });
    expect(computeAdvance({ type: 'expense', amount: 101, memberId: 'member-self', ownershipType: 'shared', shares: equalShares(101, 'member-self') }))
      .toEqual({ creditorId: 'member-self', debtorId: 'member-partner', amount: 50 });
    expect(computeAdvance({ type: 'income', amount: 1 })).toBeNull();
  });
  it('多筆代墊互相抵銷', () => {
    const a = { type: 'expense', amount: 1000, memberId: 'member-self', ownershipType: 'shared', shares: { 'member-self': 500, 'member-partner': 500 } };
    const b = { type: 'expense', amount: 300, memberId: 'member-partner', ownershipType: 'personal', ownerMemberId: 'member-self' };
    expect(netAdvances([a, b])).toEqual({ fromMemberId: 'member-partner', toMemberId: 'member-self', amount: 200 });
  });
});

describe('ID', () => {
  it('UUID 與可讀 ID 都合法', () => {
    expect(isValidId(newId())).toBe(true);
    expect(isValidId('cat-exp-food')).toBe(true);
    expect(isValidId('Bad ID')).toBe(false);
  });
});
