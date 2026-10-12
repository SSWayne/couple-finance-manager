/** 系統預設資料：首次建立資料庫時寫入。使用可讀固定 ID。 */
import { makeRecord } from './schema.js';
import { MEMBER_SELF, MEMBER_PARTNER } from '../domain/split.js';

const EXPENSE_CATEGORIES = [
  ['food', '餐飲', 'bi-cup-hot', '#F5B26B', [['breakfast', '早餐'], ['lunch', '午餐'], ['dinner', '晚餐'], ['drinks', '飲料點心']]],
  ['transport', '交通', 'bi-train-front', '#8FB8DE', [['public', '大眾運輸'], ['fuel', '油錢'], ['parking', '停車費']]],
  ['housing', '居住', 'bi-house', '#A9D94F', [['rent', '房租'], ['utilities', '水電瓦斯'], ['internet', '網路電信']]],
  ['daily', '日用品', 'bi-basket', '#EDE35C', []],
  ['entertainment', '娛樂', 'bi-controller', '#C7A4E0', []],
  ['medical', '醫療', 'bi-heart-pulse', '#E46B6B', []],
  ['clothing', '服飾', 'bi-bag', '#E7A3B8', []],
  ['education', '學習', 'bi-book', '#7FC8A9', []],
  ['insurance', '保險', 'bi-shield-check', '#9AA5B1', []],
  ['wedding', '婚禮', 'bi-heart', '#F2B45A', []],
  ['mortgage', '房貸', 'bi-bank', '#6F8F3A', []],
  ['other', '其他支出', 'bi-three-dots', '#B9BDB7', []],
];

const INCOME_CATEGORIES = [
  ['salary', '薪資', 'bi-briefcase', '#A9D94F'],
  ['bonus', '獎金', 'bi-award', '#EDE35C'],
  ['investment', '投資收益', 'bi-graph-up-arrow', '#7FC8A9'],
  ['gift', '禮金', 'bi-gift', '#F5B26B'],
  ['other', '其他收入', 'bi-three-dots', '#B9BDB7'],
];

/** 不可刪除的系統分類（其他功能依賴它）。 */
export const SYSTEM_CATEGORY_IDS = new Set(['cat-inc-gift', 'cat-exp-wedding', 'cat-exp-mortgage', 'cat-exp-other', 'cat-inc-other']);

export function defaultDataset(now = new Date().toISOString()) {
  const ts = { createdAt: now, updatedAt: now };
  const members = [
    makeRecord('members', { id: MEMBER_SELF, name: '我', role: 'self', ...ts }),
    makeRecord('members', { id: MEMBER_PARTNER, name: '另一半', role: 'partner', ...ts }),
  ];
  const categories = [];
  EXPENSE_CATEGORIES.forEach(([key, name, icon, color, subs], i) => {
    const pid = `cat-exp-${key}`;
    categories.push(makeRecord('categories', { id: pid, name, type: 'expense', icon, color, sortOrder: i, isSystem: SYSTEM_CATEGORY_IDS.has(pid), ...ts }));
    subs.forEach(([sk, sn], j) => {
      categories.push(makeRecord('categories', { id: `${pid}-${sk}`, name: sn, type: 'expense', parentId: pid, icon, color, sortOrder: j, ...ts }));
    });
  });
  INCOME_CATEGORIES.forEach(([key, name, icon, color], i) => {
    const cid = `cat-inc-${key}`;
    categories.push(makeRecord('categories', { id: cid, name, type: 'income', icon, color, sortOrder: i, isSystem: SYSTEM_CATEGORY_IDS.has(cid), ...ts }));
  });
  return {
    members,
    accounts: [],
    categories,
    transactions: [],
    budgets: [],
    settlements: [],
    weddingProject: null,
    weddingExpenses: [],
    weddingGifts: [],
    housingPlans: [],
    savingsGoals: [],
    savingsContributions: [],
    recurringTransactions: [],
    settings: makeRecord('settings', ts),
  };
}
