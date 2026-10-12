import { describe, it, expect } from 'vitest';
import { validateDataset, validateRecordShape } from '../src/data/validate.js';
import { defaultDataset } from '../src/data/seed.js';
import { buildSampleDataset } from './fixtures/sampleData.js';

const messages = (errors) => errors.map((e) => e.message).join('\n');
const txById = (ds, id) => ds.transactions.find((t) => t.id === id);

describe('validateDataset', () => {
  it('預設資料集合法', () => {
    expect(validateDataset(defaultDataset())).toEqual([]);
  });

  it('完整測試資料集合法（涵蓋 14 個集合）', () => {
    expect(messages(validateDataset(buildSampleDataset()))).toBe('');
  });

  it('拒絕未知欄位與缺少欄位', () => {
    const ds = buildSampleDataset();
    ds.accounts[0].hacked = true;
    delete ds.accounts[1].note;
    const msg = messages(validateDataset(ds));
    expect(msg).toContain('不明欄位「hacked」');
    expect(msg).toContain('缺少欄位');
  });

  it('金額必須是正整數', () => {
    const ds = buildSampleDataset();
    txById(ds, 'tx-mrt').amount = 300.5;
    expect(messages(validateDataset(ds))).toContain('整數');
    const ds2 = buildSampleDataset();
    txById(ds2, 'tx-mrt').amount = -300;
    expect(messages(validateDataset(ds2))).toContain('必須大於 0');
    const ds3 = buildSampleDataset();
    txById(ds3, 'tx-mrt').amount = 2 ** 60;
    expect(messages(validateDataset(ds3))).toContain('整數');
  });

  it('分攤加總必須等於金額，平均分攤零頭由付款人負擔', () => {
    const ds = buildSampleDataset();
    txById(ds, 'tx-grocery').shares = { 'member-self': 900, 'member-partner': 900 };
    expect(messages(validateDataset(ds))).toContain('分攤加總');
    const ds2 = buildSampleDataset();
    txById(ds2, 'tx-grocery').shares = { 'member-self': 900, 'member-partner': 901 };
    expect(messages(validateDataset(ds2))).toContain('零頭應由付款人負擔');
  });

  it('轉帳不可轉給同一帳戶、不可有分類', () => {
    const ds = buildSampleDataset();
    const t = txById(ds, 'tx-card-payment');
    t.toAccountId = t.accountId;
    t.categoryId = 'cat-exp-food';
    const msg = messages(validateDataset(ds));
    expect(msg).toContain('不可相同');
    expect(msg).toContain('轉帳不可設定分類');
  });

  it('分類類型與子分類必須一致', () => {
    const ds = buildSampleDataset();
    txById(ds, 'tx-mrt').categoryId = 'cat-inc-salary';
    expect(messages(validateDataset(ds))).toContain('不是支出分類');
    const ds2 = buildSampleDataset();
    txById(ds2, 'tx-mrt').subcategoryId = 'cat-exp-food-lunch';
    expect(messages(validateDataset(ds2))).toContain('子分類不屬於');
  });

  it('關聯不存在時拒絕', () => {
    const ds = buildSampleDataset();
    txById(ds, 'tx-mrt').accountId = 'acc-missing';
    expect(messages(validateDataset(ds))).toContain('關聯的帳戶不存在');
  });

  it('結算與交易必須雙向一致、金額等於代墊淨額', () => {
    const ds = buildSampleDataset();
    txById(ds, 'tx-grocery').settlementId = null;
    expect(messages(validateDataset(ds))).toContain('未標記為此結算');
    const ds2 = buildSampleDataset();
    ds2.settlements[0].amount = 2000;
    ds2.transactions.find((t) => t.id === 'tx-settle-sept').amount = 2000;
    expect(messages(validateDataset(ds2))).toContain('代墊淨額');
  });

  it('同月份同範圍預算不可重複', () => {
    const ds = buildSampleDataset();
    ds.budgets.push({ ...ds.budgets[0], id: 'bud-dup' });
    expect(messages(validateDataset(ds))).toContain('已有相同範圍的預算');
  });

  it('固定收支同一天不可重複產生', () => {
    const ds = buildSampleDataset();
    ds.transactions.push({ ...txById(ds, 'tx-internet-0910'), id: 'tx-internet-dup' });
    expect(messages(validateDataset(ds))).toContain('重複產生');
  });

  it('提回不可超過已累積', () => {
    const ds = buildSampleDataset();
    ds.savingsContributions.find((c) => c.id === 'contrib-3').amount = -6000;
    expect(messages(validateDataset(ds))).toContain('提回金額不可超過已累積金額');
  });

  it('成員必須剛好兩位固定 ID', () => {
    const ds = buildSampleDataset();
    ds.members.pop();
    expect(messages(validateDataset(ds))).toContain('成員必須剛好');
  });

  it('同一筆交易不可被兩個紀錄連結', () => {
    const ds = buildSampleDataset();
    ds.weddingGifts[1].accountId = 'acc-joint';
    ds.weddingGifts[1].transactionId = 'tx-wedding-gift';
    expect(messages(validateDataset(ds))).toContain('已被其他紀錄');
  });

  it('ID 重複時拒絕', () => {
    const ds = buildSampleDataset();
    ds.accounts.push({ ...ds.accounts[0] });
    expect(messages(validateDataset(ds))).toContain('ID 重複');
  });

  it('validateRecordShape 拒絕 __proto__ 等非預期欄位', () => {
    const rec = JSON.parse('{"__proto__": {"x": 1}}');
    expect(messages(validateRecordShape('members', rec))).toContain('不明欄位「__proto__」');
    expect(messages(validateRecordShape('members', { toString: 'x' }))).toContain('不明欄位「toString」');
  });
});
