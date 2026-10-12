/**
 * 涵蓋全部 14 個集合的合法測試資料集。
 * 用於備份往返測試，也可匯出成備份檔供截圖檢查（見 fixture-export.test.js）。
 */
import { defaultDataset } from '../../src/data/seed.js';
import { makeRecord, WEDDING_PROJECT_ID } from '../../src/data/schema.js';
import { equalShares, ratioShares, MEMBER_SELF as SELF, MEMBER_PARTNER as PARTNER } from '../../src/domain/split.js';

const TS = '2026-10-01T00:00:00.000Z';
const ts = { createdAt: TS, updatedAt: TS };

export function buildSampleDataset() {
  const ds = defaultDataset(TS);
  ds.members[0].name = '阿哲';
  ds.members[1].name = '小雯';

  const acc = (id, name, type, ownershipType, ownerMemberId, openingBalance, sortOrder) =>
    makeRecord('accounts', { id, name, type, ownershipType, ownerMemberId, openingBalance, openingDate: '2026-08-31', sortOrder, ...ts });
  ds.accounts = [
    acc('acc-joint', '共同生活帳戶', 'bank', 'shared', null, 100000, 0),
    acc('acc-self-bank', '阿哲薪轉', 'bank', 'personal', SELF, 50000, 1),
    acc('acc-partner-bank', '小雯薪轉', 'bank', 'personal', PARTNER, 60000, 2),
    acc('acc-self-card', '阿哲信用卡', 'credit_card', 'personal', SELF, 0, 3),
    acc('acc-house-fund', '購屋基金', 'savings', 'shared', null, 0, 4),
  ];

  const tx = (id, fields) => makeRecord('transactions', { id, paymentMethod: null, ...fields, ...ts });
  const personal = (owner) => ({ ownershipType: 'personal', ownerMemberId: owner, splitMode: 'none', shares: null });
  const shared = (amount, payer, mode = 'equal', shares = equalShares(amount, payer)) => ({
    ownershipType: 'shared', ownerMemberId: null, splitMode: mode, shares,
  });
  const transfer = { categoryId: null, ownershipType: null, ownerMemberId: null, splitMode: 'none', shares: null };

  ds.transactions = [
    tx('tx-salary-self', { date: '2026-09-05', type: 'income', amount: 52000, categoryId: 'cat-inc-salary', accountId: 'acc-self-bank', memberId: SELF, ...personal(SELF), description: '九月薪資' }),
    tx('tx-salary-partner', { date: '2026-09-05', type: 'income', amount: 48000, categoryId: 'cat-inc-salary', accountId: 'acc-partner-bank', memberId: PARTNER, ...personal(PARTNER), description: '九月薪資' }),
    tx('tx-grocery', { date: '2026-09-07', type: 'expense', amount: 1801, categoryId: 'cat-exp-daily', accountId: 'acc-self-card', memberId: SELF, ...shared(1801, SELF), paymentMethod: 'credit_card', description: '全聯採買', tags: ['日常'], settlementId: 'stl-sept' }),
    tx('tx-dinner', { date: '2026-09-12', type: 'expense', amount: 2000, categoryId: 'cat-exp-food', subcategoryId: 'cat-exp-food-dinner', accountId: 'acc-partner-bank', memberId: PARTNER, ...shared(2000, PARTNER, 'ratio', ratioShares(2000, PARTNER, { [SELF]: 40, [PARTNER]: 60 })), description: '週末晚餐' }),
    tx('tx-rent', { date: '2026-09-01', type: 'expense', amount: 20000, categoryId: 'cat-exp-housing', subcategoryId: 'cat-exp-housing-rent', accountId: 'acc-joint', memberId: SELF, ...shared(20000, SELF, 'amount', { [SELF]: 10000, [PARTNER]: 10000 }), paymentMethod: 'transfer', description: '九月房租' }),
    tx('tx-gift-for-partner', { date: '2026-09-15', type: 'expense', amount: 1500, categoryId: 'cat-exp-clothing', accountId: 'acc-self-bank', memberId: SELF, ...personal(PARTNER), description: '幫小雯買外套', settlementId: 'stl-sept' }),
    tx('tx-card-payment', { date: '2026-09-25', type: 'transfer', amount: 1801, accountId: 'acc-self-bank', toAccountId: 'acc-self-card', memberId: SELF, ...transfer, description: '繳信用卡費' }),
    tx('tx-mrt', { date: '2026-09-18', type: 'expense', amount: 300, categoryId: 'cat-exp-transport', subcategoryId: 'cat-exp-transport-public', accountId: 'acc-self-bank', memberId: SELF, ...personal(SELF), paymentMethod: 'e_payment' }),
    tx('tx-venue-deposit', { date: '2026-09-20', type: 'expense', amount: 30000, categoryId: 'cat-exp-wedding', accountId: 'acc-joint', memberId: SELF, ...shared(30000, SELF), description: '婚宴訂金', weddingExpenseId: 'we-banquet' }),
    tx('tx-wedding-gift', { date: '2026-09-28', type: 'income', amount: 6600, categoryId: 'cat-inc-gift', accountId: 'acc-joint', memberId: SELF, ownershipType: 'shared', ownerMemberId: null, splitMode: 'none', shares: null, description: '禮金：張阿姨' }),
    tx('tx-internet-0910', { date: '2026-09-10', type: 'expense', amount: 999, categoryId: 'cat-exp-housing', subcategoryId: 'cat-exp-housing-internet', accountId: 'acc-self-bank', memberId: SELF, ...shared(999, SELF), description: '光纖網路', recurringId: 'rec-internet', recurringDate: '2026-09-10' }),
    tx('tx-save-house', { date: '2026-09-30', type: 'transfer', amount: 10000, accountId: 'acc-joint', toAccountId: 'acc-house-fund', memberId: SELF, ...transfer, description: '購屋基金撥款' }),
    tx('tx-settle-sept', { date: '2026-09-30', type: 'transfer', amount: 2400, accountId: 'acc-partner-bank', toAccountId: 'acc-self-bank', memberId: PARTNER, ...transfer, description: '代墊結算' }),
    tx('tx-lunch-oct', { date: '2026-10-03', type: 'expense', amount: 260, categoryId: 'cat-exp-food', subcategoryId: 'cat-exp-food-lunch', accountId: 'acc-self-card', memberId: SELF, ...personal(SELF), paymentMethod: 'credit_card' }),
    tx('tx-salary-self-oct', { date: '2026-10-05', type: 'income', amount: 52000, categoryId: 'cat-inc-salary', accountId: 'acc-self-bank', memberId: SELF, ...personal(SELF), description: '十月薪資' }),
  ];

  ds.settlements = [
    makeRecord('settlements', {
      id: 'stl-sept', date: '2026-09-30', fromMemberId: PARTNER, toMemberId: SELF, amount: 2400,
      transactionIds: ['tx-grocery', 'tx-gift-for-partner'], transferTransactionId: 'tx-settle-sept', note: '九月代墊', ...ts,
    }),
  ];

  ds.budgets = [
    makeRecord('budgets', { id: 'bud-household-oct', month: '2026-10', scope: 'household', amount: 60000, ...ts }),
    makeRecord('budgets', { id: 'bud-food-oct', month: '2026-10', scope: 'category', categoryId: 'cat-exp-food', amount: 8000, ...ts }),
    makeRecord('budgets', { id: 'bud-self-oct', month: '2026-10', scope: 'personal', memberId: SELF, amount: 5000, ...ts }),
  ];

  ds.weddingProject = makeRecord('weddingProject', { id: WEDDING_PROJECT_ID, name: '阿哲與小雯的婚禮', weddingDate: '2027-05-20', totalBudget: 800000, ...ts });
  const items = ['banquet:婚宴', 'photo:婚紗攝影', 'rings:婚戒', 'cookies:喜餅', 'makeup:新娘秘書', 'decor:婚禮佈置', 'invites:喜帖', 'honeymoon:蜜月', 'other:其他'];
  ds.weddingExpenses = items.map((s, i) => {
    const [key, name] = s.split(':');
    return makeRecord('weddingExpenses', { id: `we-${key}`, name, sortOrder: i, ...ts });
  });
  ds.weddingExpenses[0].estimatedAmount = 450000;
  ds.weddingExpenses[2].manualPaidAmount = 40000;
  ds.weddingExpenses[2].manualPaidNote = '長輩代付';
  ds.weddingGifts = [
    makeRecord('weddingGifts', { id: 'gift-aunt', giverName: '張阿姨', relation: '親戚', side: 'partner', amount: 6600, date: '2026-09-28', accountId: 'acc-joint', transactionId: 'tx-wedding-gift', ...ts }),
    makeRecord('weddingGifts', { id: 'gift-boss', giverName: '王經理', relation: '同事', side: 'self', amount: 3600, date: '2026-09-29', ...ts }),
  ];

  ds.housingPlans = [
    makeRecord('housingPlans', { id: 'house-plan-a', name: '新北兩房', housePrice: 12000000, downPayment: 2400000, loanAmount: 9600000, annualRate: 2.185, loanYears: 30, gracePeriodYears: 2, startMonth: '2027-07', otherCosts: 300000, ...ts }),
  ];

  ds.savingsGoals = [
    makeRecord('savingsGoals', { id: 'goal-house', name: '購屋頭期款', targetAmount: 2400000, targetDate: '2028-12-31', accountId: 'acc-house-fund', icon: 'bi-house-heart', ...ts }),
    makeRecord('savingsGoals', { id: 'goal-trip', name: '蜜月旅行', targetAmount: 150000, ownershipType: 'shared', ...ts }),
  ];
  ds.savingsContributions = [
    makeRecord('savingsContributions', { id: 'contrib-1', goalId: 'goal-house', date: '2026-09-30', amount: 10000, memberId: SELF, fromAccountId: 'acc-joint', transferTransactionId: 'tx-save-house', ...ts }),
    makeRecord('savingsContributions', { id: 'contrib-2', goalId: 'goal-trip', date: '2026-10-01', amount: 5000, memberId: PARTNER, ...ts }),
    makeRecord('savingsContributions', { id: 'contrib-3', goalId: 'goal-trip', date: '2026-10-02', amount: -1000, memberId: PARTNER, note: '提回', ...ts }),
  ];

  ds.recurringTransactions = [
    makeRecord('recurringTransactions', {
      id: 'rec-internet', name: '光纖網路', frequency: 'monthly', startDate: '2026-09-10', lastGeneratedDate: '2026-09-10',
      type: 'expense', amount: 999, categoryId: 'cat-exp-housing', subcategoryId: 'cat-exp-housing-internet', accountId: 'acc-self-bank',
      memberId: SELF, ...shared(999, SELF), paymentMethod: null, description: '光纖網路', ...ts,
    }),
  ];

  ds.settings.backupReminderDays = 10;
  return ds;
}
