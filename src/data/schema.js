/**
 * 單一資料來源（Single Source of Truth）。
 *
 * 匯出、匯入、驗證、建立預設值、Dexie 索引、刪除前引用檢查，全部由這份定義自動推導：
 * - fields：欄位型別、是否可為 null、預設值、關聯（ref / refList）。
 * - rules(record, ctx)：單筆紀錄的商業規則（可查詢其他集合）。
 * - datasetRules(ctx)：整個資料集的規則（唯一性、雙向一致等）。
 *
 * 新增欄位或集合時：提升 SCHEMA_VERSION，並在 migrate.js 加上舊版轉換。
 */
import { computeAdvance, equalShares, MEMBER_IDS, MEMBER_SELF, MEMBER_PARTNER, sumShares, netAdvances } from '../domain/split.js';

export const BACKUP_FORMAT = 'couple-finance-backup';
export const SCHEMA_VERSION = 1;
export const DB_NAME = 'couple-finance-manager';

export const SETTINGS_ID = 'settings';
export const WEDDING_PROJECT_ID = 'wedding-project';
export const GIFT_CATEGORY_ID = 'cat-inc-gift';

// ---------------------------------------------------------------------------
// 欄位定義小工具
// ---------------------------------------------------------------------------
const id = () => ({ type: 'id' });
const ref = (collection, opts = {}) => ({ type: 'ref', collection, nullable: true, default: null, ...opts });
const refList = (collection, opts = {}) => ({ type: 'refList', collection, default: [], ...opts });
const str = (opts = {}) => ({ type: 'string', min: 0, max: 200, default: '', ...opts });
const int = (opts = {}) => ({ type: 'int', default: 0, ...opts });
const money = (opts = {}) => ({ type: 'money', default: 0, ...opts });
const decimal = (opts = {}) => ({ type: 'decimal', default: 0, maxDecimals: 4, ...opts });
const bool = (def = false) => ({ type: 'bool', default: def });
const enumOf = (values, opts = {}) => ({ type: 'enum', values, default: values[0], ...opts });
const date = (opts = {}) => ({ type: 'date', default: null, ...opts });
const month = (opts = {}) => ({ type: 'month', default: null, ...opts });
const datetime = (opts = {}) => ({ type: 'datetime', default: null, ...opts });
const tags = () => ({ type: 'tags', default: [], maxItems: 10, maxLength: 20 });
const shares = () => ({ type: 'shares', nullable: true, default: null });

const timestamps = () => ({ createdAt: datetime(), updatedAt: datetime() });

// ---------------------------------------------------------------------------
// 列舉
// ---------------------------------------------------------------------------
export const ENUMS = {
  memberRole: { self: '我', partner: '另一半' },
  accountType: {
    bank: '銀行帳戶',
    cash: '現金',
    credit_card: '信用卡',
    e_wallet: '電子支付',
    savings: '儲蓄帳戶',
    investment: '投資帳戶',
    other: '其他',
  },
  ownershipType: { personal: '個人', shared: '共同' },
  categoryType: { expense: '支出', income: '收入' },
  transactionType: { expense: '支出', income: '收入', transfer: '轉帳' },
  splitMode: { none: '不分攤', equal: '平均分攤（50/50）', ratio: '自訂比例', amount: '自訂金額' },
  paymentMethod: {
    cash: '現金',
    credit_card: '信用卡',
    debit_card: '金融卡',
    transfer: '轉帳',
    e_payment: '電子支付',
    other: '其他',
  },
  budgetScope: { household: '家庭總預算', personal: '個人預算', shared: '共同預算', category: '分類預算' },
  giftSide: { self: '我方', partner: '對方', both: '共同' },
  goalStatus: { active: '進行中', completed: '已完成', archived: '已封存' },
  frequency: { weekly: '每週', monthly: '每月', quarterly: '每季', yearly: '每年' },
  dashboardPeriod: { '7d': '7 天', month: '本月', '3m': '3 個月', '6m': '6 個月', '12m': '12 個月' },
};
const keys = (o) => Object.keys(o);

// ---------------------------------------------------------------------------
// 交易欄位（固定收支範本共用大部分欄位）
// ---------------------------------------------------------------------------
const transactionCoreFields = () => ({
  type: enumOf(keys(ENUMS.transactionType)),
  amount: money({ min: 1, default: null }),
  categoryId: ref('categories'),
  subcategoryId: ref('categories'),
  accountId: ref('accounts', { nullable: false, default: null }),
  toAccountId: ref('accounts'),
  memberId: ref('members', { nullable: false, default: MEMBER_SELF }),
  ownershipType: enumOf(keys(ENUMS.ownershipType), { nullable: true, default: 'shared' }),
  ownerMemberId: ref('members'),
  splitMode: enumOf(keys(ENUMS.splitMode), { default: 'equal' }),
  shares: shares(),
  paymentMethod: enumOf(keys(ENUMS.paymentMethod), { nullable: true, default: null }),
  description: str({ max: 200 }),
  tags: tags(),
});

/** 收入／支出／轉帳共用的商業規則；也用於固定收支範本。 */
function transactionShapeRules(t, ctx, err) {
  if (t.type === 'transfer') {
    if (!t.toAccountId) err('toAccountId', '轉帳必須選擇轉入帳戶');
    else if (t.toAccountId === t.accountId) err('toAccountId', '轉出與轉入帳戶不可相同');
    if (t.categoryId) err('categoryId', '轉帳不可設定分類');
    if (t.subcategoryId) err('subcategoryId', '轉帳不可設定子分類');
    if (t.ownershipType !== null) err('ownershipType', '轉帳不設定個人／共同歸屬');
    if (t.ownerMemberId) err('ownerMemberId', '轉帳不設定歸屬成員');
    if (t.splitMode !== 'none') err('splitMode', '轉帳不分攤');
    if (t.shares !== null) err('shares', '轉帳不分攤');
    return;
  }

  if (t.toAccountId) err('toAccountId', '只有轉帳可以設定轉入帳戶');
  if (!t.categoryId) {
    err('categoryId', '請選擇分類');
  } else {
    const cat = ctx.get('categories', t.categoryId);
    if (cat) {
      if (cat.type !== t.type) err('categoryId', `分類「${cat.name}」不是${ENUMS.transactionType[t.type]}分類`);
      if (cat.parentId) err('categoryId', '主分類欄位不可選擇子分類');
    }
  }
  if (t.subcategoryId) {
    const sub = ctx.get('categories', t.subcategoryId);
    if (sub && sub.parentId !== t.categoryId) err('subcategoryId', '子分類不屬於所選的主分類');
  }

  if (!t.ownershipType) {
    err('ownershipType', '請選擇個人或共同');
    return;
  }
  if (t.ownershipType === 'personal') {
    if (!t.ownerMemberId) err('ownerMemberId', '個人收支必須指定歸屬成員');
    if (t.splitMode !== 'none') err('splitMode', '個人收支不分攤');
    if (t.shares !== null) err('shares', '個人收支不分攤');
    return;
  }
  // shared
  if (t.ownerMemberId) err('ownerMemberId', '共同收支不指定單一歸屬成員');
  if (t.type === 'income') {
    if (t.splitMode !== 'none') err('splitMode', '收入不分攤');
    if (t.shares !== null) err('shares', '收入不分攤');
    return;
  }
  if (t.splitMode === 'none') {
    err('splitMode', '共同支出必須選擇分攤方式');
    return;
  }
  if (!t.shares) {
    err('shares', '共同支出必須設定分攤金額');
    return;
  }
  const shareKeys = Object.keys(t.shares).sort();
  if (shareKeys.join(',') !== [...MEMBER_IDS].sort().join(',')) {
    err('shares', '分攤必須包含兩位成員');
    return;
  }
  if (Number.isSafeInteger(t.amount) && sumShares(t.shares) !== t.amount) {
    err('shares', `分攤加總 ${sumShares(t.shares)} 不等於金額 ${t.amount}`);
  }
  if (t.splitMode === 'equal' && Number.isSafeInteger(t.amount)) {
    const expected = equalShares(t.amount, t.memberId);
    if (MEMBER_IDS.some((m) => expected[m] !== t.shares[m])) {
      err('shares', '平均分攤的金額不正確（零頭應由付款人負擔）');
    }
  }
}

// ---------------------------------------------------------------------------
// 集合定義
// ---------------------------------------------------------------------------
export const COLLECTIONS = {
  members: {
    label: '成員',
    kind: 'list',
    indexes: 'id',
    fields: {
      id: id(),
      name: str({ min: 1, max: 20, default: null }),
      role: enumOf(keys(ENUMS.memberRole)),
      ...timestamps(),
    },
    rules(m, _ctx, err) {
      const expectedRole = m.id === MEMBER_SELF ? 'self' : m.id === MEMBER_PARTNER ? 'partner' : null;
      if (!expectedRole) err('id', '成員固定為「我」與「另一半」兩位');
      else if (m.role !== expectedRole) err('role', '成員角色與 ID 不符');
    },
  },

  accounts: {
    label: '帳戶',
    kind: 'list',
    indexes: 'id, type, archived',
    fields: {
      id: id(),
      name: str({ min: 1, max: 40, default: null }),
      type: enumOf(keys(ENUMS.accountType)),
      ownershipType: enumOf(keys(ENUMS.ownershipType), { default: 'shared' }),
      ownerMemberId: ref('members'),
      openingBalance: money({ default: 0 }),
      openingDate: date({ nullable: true }),
      archived: bool(false),
      note: str({ max: 200 }),
      sortOrder: int({ min: 0 }),
      ...timestamps(),
    },
    rules(a, _ctx, err) {
      if (a.ownershipType === 'personal' && !a.ownerMemberId) err('ownerMemberId', '個人帳戶必須指定擁有者');
      if (a.ownershipType === 'shared' && a.ownerMemberId) err('ownerMemberId', '共同帳戶不指定擁有者');
    },
  },

  categories: {
    label: '分類',
    kind: 'list',
    indexes: 'id, type, parentId',
    fields: {
      id: id(),
      name: str({ min: 1, max: 20, default: null }),
      type: enumOf(keys(ENUMS.categoryType)),
      parentId: ref('categories'),
      icon: str({ max: 40, default: 'bi-tag' }),
      color: str({ max: 20, default: '#A9D94F' }),
      archived: bool(false),
      isSystem: bool(false),
      sortOrder: int({ min: 0 }),
      ...timestamps(),
    },
    rules(c, ctx, err) {
      if (c.icon && !/^bi-[a-z0-9-]+$/.test(c.icon)) err('icon', '圖示格式不正確');
      if (c.color && !/^#[0-9A-Fa-f]{6}$/.test(c.color)) err('color', '顏色格式須為 #RRGGBB');
      if (!c.parentId) return;
      if (c.parentId === c.id) {
        err('parentId', '分類不可以自己為上層');
        return;
      }
      const parent = ctx.get('categories', c.parentId);
      if (!parent) return;
      if (parent.parentId) err('parentId', '子分類只能有一層');
      if (parent.type !== c.type) err('parentId', '子分類與主分類的收支類型必須相同');
    },
  },

  transactions: {
    label: '交易',
    kind: 'list',
    indexes:
      'id, date, type, categoryId, subcategoryId, accountId, toAccountId, memberId, settlementId, weddingExpenseId, recurringId, &[recurringId+recurringDate]',
    fields: {
      id: id(),
      date: date({ nullable: false }),
      ...transactionCoreFields(),
      settlementId: ref('settlements'),
      recurringId: ref('recurringTransactions'),
      recurringDate: date({ nullable: true }),
      weddingExpenseId: ref('weddingExpenses'),
      ...timestamps(),
    },
    rules(t, ctx, err) {
      transactionShapeRules(t, ctx, err);
      if (t.type !== 'expense' && t.weddingExpenseId) err('weddingExpenseId', '只有支出可以關聯婚禮項目');
      if ((t.recurringId === null) !== (t.recurringDate === null)) {
        err('recurringDate', '固定收支來源與日期必須同時存在');
      }
      if (t.settlementId) {
        const adv = computeAdvance(t);
        if (!adv) err('settlementId', '沒有代墊金額的交易不可結算');
        const s = ctx.get('settlements', t.settlementId);
        if (s && !s.transactionIds.includes(t.id)) err('settlementId', '結算紀錄未包含此交易（雙向不一致）');
      }
    },
  },

  budgets: {
    label: '預算',
    kind: 'list',
    indexes: 'id, month, scope',
    fields: {
      id: id(),
      month: month({ nullable: false }),
      scope: enumOf(keys(ENUMS.budgetScope)),
      memberId: ref('members'),
      categoryId: ref('categories'),
      amount: money({ min: 1, default: null }),
      note: str({ max: 100 }),
      ...timestamps(),
    },
    rules(b, ctx, err) {
      if (b.scope === 'personal' ? !b.memberId : b.memberId) {
        err('memberId', b.scope === 'personal' ? '個人預算必須指定成員' : '只有個人預算可以指定成員');
      }
      if (b.scope === 'category') {
        if (!b.categoryId) err('categoryId', '分類預算必須指定分類');
        const c = b.categoryId && ctx.get('categories', b.categoryId);
        if (c && (c.type !== 'expense' || c.parentId)) err('categoryId', '分類預算只能選擇支出主分類（含子分類）');
      } else if (b.categoryId) {
        err('categoryId', '只有分類預算可以指定分類');
      }
    },
  },

  settlements: {
    label: '結算',
    kind: 'list',
    indexes: 'id, date',
    fields: {
      id: id(),
      date: date({ nullable: false }),
      fromMemberId: ref('members', { nullable: false, default: null }),
      toMemberId: ref('members', { nullable: false, default: null }),
      amount: money({ min: 0 }),
      transactionIds: refList('transactions', { minItems: 1 }),
      transferTransactionId: ref('transactions', { exclusiveLink: true }),
      note: str({ max: 200 }),
      ...timestamps(),
    },
    rules(s, ctx, err) {
      if (s.fromMemberId === s.toMemberId) err('toMemberId', '付款人與收款人不可相同');
      const txs = [];
      for (const txId of s.transactionIds) {
        const t = ctx.get('transactions', txId);
        if (!t) continue;
        if (t.settlementId !== s.id) err('transactionIds', `交易 ${txId} 未標記為此結算（雙向不一致）`);
        txs.push(t);
      }
      if (txs.length === s.transactionIds.length) {
        const net = netAdvances(txs);
        if (net.amount !== s.amount) err('amount', `結算金額 ${s.amount} 與代墊淨額 ${net.amount} 不符`);
        else if (net.amount > 0 && net.fromMemberId !== s.fromMemberId) err('fromMemberId', '結算方向與代墊淨額不符');
      }
      if (s.transferTransactionId) {
        if (s.amount === 0) err('transferTransactionId', '淨額為 0 時不需要結算轉帳');
        const t = ctx.get('transactions', s.transferTransactionId);
        if (t) {
          if (t.type !== 'transfer') err('transferTransactionId', '結算轉帳必須是轉帳交易');
          if (t.amount !== s.amount) err('transferTransactionId', '結算轉帳金額與結算金額不符');
          if (t.memberId !== s.fromMemberId) err('transferTransactionId', '結算轉帳的付款人必須是應付款的一方');
        }
      }
    },
  },

  weddingProject: {
    label: '婚禮專案',
    kind: 'single',
    nullable: true,
    fixedId: WEDDING_PROJECT_ID,
    indexes: 'id',
    fields: {
      id: id(),
      name: str({ min: 1, max: 40, default: '我們的婚禮' }),
      weddingDate: date({ nullable: true }),
      totalBudget: money({ min: 0 }),
      note: str({ max: 500 }),
      ...timestamps(),
    },
  },

  weddingExpenses: {
    label: '婚禮項目',
    kind: 'list',
    indexes: 'id',
    fields: {
      id: id(),
      name: str({ min: 1, max: 40, default: null }),
      estimatedAmount: money({ min: 0 }),
      actualAmount: money({ min: 0, nullable: true, default: null }),
      manualPaidAmount: money({ min: 0 }),
      manualPaidNote: str({ max: 200 }),
      vendor: str({ max: 60 }),
      dueDate: date({ nullable: true }),
      note: str({ max: 500 }),
      sortOrder: int({ min: 0 }),
      ...timestamps(),
    },
  },

  weddingGifts: {
    label: '禮金',
    kind: 'list',
    indexes: 'id, date',
    fields: {
      id: id(),
      giverName: str({ min: 1, max: 40, default: null }),
      relation: str({ max: 40 }),
      side: enumOf(keys(ENUMS.giftSide)),
      amount: money({ min: 1, default: null }),
      date: date({ nullable: false }),
      accountId: ref('accounts'),
      transactionId: ref('transactions', { exclusiveLink: true }),
      note: str({ max: 200 }),
      ...timestamps(),
    },
    rules(g, ctx, err) {
      if ((g.accountId === null) !== (g.transactionId === null)) {
        err('transactionId', '選擇入帳帳戶時必須同時有禮金收入交易');
      }
      if (!g.transactionId) return;
      const t = ctx.get('transactions', g.transactionId);
      if (!t) return;
      if (t.type !== 'income' || t.categoryId !== GIFT_CATEGORY_ID) err('transactionId', '禮金交易必須是「禮金」收入');
      if (t.amount !== g.amount) err('transactionId', '禮金交易金額與禮金不符');
      if (t.accountId !== g.accountId) err('transactionId', '禮金交易帳戶與入帳帳戶不符');
      if (t.date !== g.date) err('transactionId', '禮金交易日期與禮金日期不符');
    },
  },

  housingPlans: {
    label: '購屋規劃',
    kind: 'list',
    indexes: 'id',
    fields: {
      id: id(),
      name: str({ min: 1, max: 40, default: null }),
      housePrice: money({ min: 1, default: null }),
      downPayment: money({ min: 0 }),
      loanAmount: money({ min: 0 }),
      annualRate: decimal({ min: 0, max: 30, default: 2 }),
      loanYears: int({ min: 1, max: 40, default: 30 }),
      gracePeriodYears: int({ min: 0, max: 5, default: 0 }),
      startMonth: month({ nullable: true }),
      otherCosts: money({ min: 0 }),
      note: str({ max: 500 }),
      ...timestamps(),
    },
    rules(p, _ctx, err) {
      if (p.downPayment > p.housePrice) err('downPayment', '頭期款不可超過房價');
      if (p.loanAmount > p.housePrice) err('loanAmount', '貸款金額不可超過房價');
      if (p.gracePeriodYears >= p.loanYears) err('gracePeriodYears', '寬限期必須短於貸款年限');
    },
  },

  savingsGoals: {
    label: '儲蓄目標',
    kind: 'list',
    indexes: 'id, status',
    fields: {
      id: id(),
      name: str({ min: 1, max: 40, default: null }),
      targetAmount: money({ min: 1, default: null }),
      targetDate: date({ nullable: true }),
      accountId: ref('accounts'),
      ownershipType: enumOf(keys(ENUMS.ownershipType), { default: 'shared' }),
      ownerMemberId: ref('members'),
      status: enumOf(keys(ENUMS.goalStatus)),
      icon: str({ max: 40, default: 'bi-piggy-bank' }),
      note: str({ max: 200 }),
      ...timestamps(),
    },
    rules(g, _ctx, err) {
      if (g.ownershipType === 'personal' && !g.ownerMemberId) err('ownerMemberId', '個人目標必須指定成員');
      if (g.ownershipType === 'shared' && g.ownerMemberId) err('ownerMemberId', '共同目標不指定成員');
      if (g.icon && !/^bi-[a-z0-9-]+$/.test(g.icon)) err('icon', '圖示格式不正確');
    },
  },

  savingsContributions: {
    label: '儲蓄撥款',
    kind: 'list',
    indexes: 'id, goalId, date',
    fields: {
      id: id(),
      goalId: ref('savingsGoals', { nullable: false, default: null }),
      date: date({ nullable: false }),
      amount: money({ default: null }),
      memberId: ref('members', { nullable: false, default: MEMBER_SELF }),
      fromAccountId: ref('accounts'),
      transferTransactionId: ref('transactions', { exclusiveLink: true }),
      note: str({ max: 200 }),
      ...timestamps(),
    },
    rules(c, ctx, err) {
      if (c.amount === 0) err('amount', '撥款金額不可為 0（正數為撥入、負數為提回）');
      if ((c.fromAccountId === null) !== (c.transferTransactionId === null)) {
        err('transferTransactionId', '選擇轉出帳戶時必須同時建立轉帳');
      }
      if (!c.transferTransactionId) return;
      if (c.amount < 0) err('transferTransactionId', '提回不可建立轉帳');
      const goal = ctx.get('savingsGoals', c.goalId);
      const t = ctx.get('transactions', c.transferTransactionId);
      if (goal && !goal.accountId) err('fromAccountId', '目標未設定目標帳戶，無法建立轉帳');
      if (t) {
        if (t.type !== 'transfer') err('transferTransactionId', '撥款轉帳必須是轉帳交易');
        if (t.amount !== c.amount) err('transferTransactionId', '撥款轉帳金額不符');
        if (t.accountId !== c.fromAccountId) err('transferTransactionId', '撥款轉帳的轉出帳戶不符');
        if (goal && t.toAccountId !== goal.accountId) err('transferTransactionId', '撥款轉帳的轉入帳戶必須是目標帳戶');
      }
    },
  },

  recurringTransactions: {
    label: '固定收支',
    kind: 'list',
    indexes: 'id, active',
    fields: {
      id: id(),
      name: str({ min: 1, max: 40, default: null }),
      frequency: enumOf(keys(ENUMS.frequency), { default: 'monthly' }),
      startDate: date({ nullable: false }),
      endDate: date({ nullable: true }),
      active: bool(true),
      /** 恢復啟用時設定為恢復當天：此日期之前（暫停期間）的期數不補產生。 */
      skipBefore: date({ nullable: true }),
      lastGeneratedDate: date({ nullable: true }),
      ...transactionCoreFields(),
      ...timestamps(),
    },
    rules(r, ctx, err) {
      transactionShapeRules(r, ctx, err);
      if (r.endDate && r.endDate < r.startDate) err('endDate', '結束日不可早於開始日');
    },
  },

  settings: {
    label: '設定',
    kind: 'single',
    nullable: false,
    fixedId: SETTINGS_ID,
    indexes: 'id',
    fields: {
      id: id(),
      backupReminderDays: int({ min: 1, max: 365, default: 7 }),
      lastBackupAt: datetime({ nullable: true }),
      dashboardPeriod: enumOf(keys(ENUMS.dashboardPeriod), { default: 'month' }),
      /** 金額格式：目前固定 TWD／小數位數 0，未來升級多幣別時由 migrate() 轉換。 */
      currency: enumOf(['TWD']),
      currencyExponent: int({ min: 0, max: 0, default: 0 }),
      ...timestamps(),
    },
  },
};

export const COLLECTION_NAMES = Object.keys(COLLECTIONS);
export const LIST_COLLECTIONS = COLLECTION_NAMES.filter((n) => COLLECTIONS[n].kind === 'list');
export const SINGLE_COLLECTIONS = COLLECTION_NAMES.filter((n) => COLLECTIONS[n].kind === 'single');

/** Dexie stores 定義，由 schema 推導。 */
export function dexieStores() {
  return Object.fromEntries(COLLECTION_NAMES.map((n) => [n, COLLECTIONS[n].indexes]));
}

// ---------------------------------------------------------------------------
// 整個資料集的規則
// ---------------------------------------------------------------------------
export const datasetRules = [
  function membersFixed(ctx, err) {
    const ids = ctx.dataset.members.map((m) => m.id).sort();
    if (ids.join(',') !== [MEMBER_SELF, MEMBER_PARTNER].sort().join(',')) {
      err('members', null, null, '成員必須剛好是「我」與「另一半」兩位');
    }
  },
  function recurringUnique(ctx, err) {
    const seen = new Set();
    for (const t of ctx.dataset.transactions) {
      if (!t.recurringId) continue;
      const key = `${t.recurringId}|${t.recurringDate}`;
      if (seen.has(key)) err('transactions', t.id, 'recurringDate', '同一固定收支在同一天重複產生交易');
      seen.add(key);
    }
  },
  function budgetUnique(ctx, err) {
    const seen = new Set();
    for (const b of ctx.dataset.budgets) {
      const key = `${b.month}|${b.scope}|${b.memberId ?? ''}|${b.categoryId ?? ''}`;
      if (seen.has(key)) err('budgets', b.id, 'month', `${b.month} 已有相同範圍的預算`);
      seen.add(key);
    }
  },
  function weddingRequiresProject(ctx, err) {
    if (ctx.dataset.weddingProject) return;
    if (ctx.dataset.weddingExpenses.length || ctx.dataset.weddingGifts.length) {
      err('weddingProject', null, null, '有婚禮項目或禮金時必須有婚禮專案');
    }
  },
  function contributionsNotNegative(ctx, err) {
    const byGoal = new Map();
    const sorted = [...ctx.dataset.savingsContributions].sort(
      (a, b) => a.date.localeCompare(b.date) || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''),
    );
    for (const c of sorted) {
      const total = (byGoal.get(c.goalId) ?? 0) + (Number.isSafeInteger(c.amount) ? c.amount : 0);
      if (total < 0) err('savingsContributions', c.id, 'amount', '提回金額不可超過已累積金額');
      byGoal.set(c.goalId, total);
    }
  },
  /** 一筆交易最多只能被一個「擁有者」（結算轉帳、禮金、撥款轉帳）連結。 */
  function exclusiveLinks(ctx, err) {
    const owners = new Map();
    for (const [collection, field] of exclusiveLinkFields()) {
      for (const rec of ctx.list(collection)) {
        const txId = rec[field];
        if (!txId) continue;
        if (owners.has(txId)) {
          err(collection, rec.id, field, `交易 ${txId} 已被其他紀錄（${owners.get(txId)}）連結`);
        } else {
          owners.set(txId, `${COLLECTIONS[collection].label}`);
        }
      }
    }
  },
];

function exclusiveLinkFields() {
  const out = [];
  for (const [name, def] of Object.entries(COLLECTIONS)) {
    for (const [field, f] of Object.entries(def.fields)) {
      if (f.exclusiveLink) out.push([name, field]);
    }
  }
  return out;
}

/**
 * 反向引用索引：哪些集合的哪些欄位指向 target 集合。
 * 刪除前引用檢查用；shares 的 key 指向 members。
 */
export function referencingFields(target) {
  const out = [];
  for (const [name, def] of Object.entries(COLLECTIONS)) {
    for (const [field, f] of Object.entries(def.fields)) {
      if ((f.type === 'ref' || f.type === 'refList') && f.collection === target) out.push({ collection: name, field, list: f.type === 'refList' });
      if (f.type === 'shares' && target === 'members') out.push({ collection: name, field, shares: true });
    }
  }
  return out;
}

/** 依 schema 預設值建立新紀錄（不含 id 與時間戳，由寫入層補）。 */
export function makeRecord(collection, values = {}) {
  const def = COLLECTIONS[collection];
  const rec = {};
  for (const [field, f] of Object.entries(def.fields)) {
    const d = f.default;
    rec[field] = Array.isArray(d) ? [...d] : d ?? null;
  }
  if (def.fixedId) rec.id = def.fixedId;
  return { ...rec, ...values };
}
