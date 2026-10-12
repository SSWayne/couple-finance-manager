/**
 * 帳戶餘額與收支統計（純函式）。
 *
 * - 帳戶餘額不儲存，一律＝期初餘額＋交易推算。
 * - 轉帳只在帳戶間移動，不算收入也不算支出。
 * - 信用卡以負餘額表示欠款：刷卡＝支出（餘額變更負）；繳卡費＝銀行轉帳到信用卡（不再算支出）。
 * - 資產＝正餘額合計；負債＝負餘額絕對值合計。
 */

export function computeBalances(dataset, { upTo = null } = {}) {
  const balances = new Map(dataset.accounts.map((a) => [a.id, a.openingBalance]));
  const add = (id, delta) => balances.set(id, (balances.get(id) ?? 0) + delta);
  for (const t of dataset.transactions) {
    if (upTo && t.date > upTo) continue;
    if (t.type === 'income') add(t.accountId, t.amount);
    else if (t.type === 'expense') add(t.accountId, -t.amount);
    else if (t.type === 'transfer') {
      add(t.accountId, -t.amount);
      add(t.toAccountId, t.amount);
    }
  }
  return balances;
}

export function netWorth(dataset, options) {
  const balances = computeBalances(dataset, options);
  let assets = 0;
  let liabilities = 0;
  for (const v of balances.values()) {
    if (v > 0) assets += v;
    else liabilities += -v;
  }
  return { assets, liabilities, net: assets - liabilities, balances };
}

/** 期間收支（含起訖日）。轉帳不計入。儲蓄率＝結餘÷收入，收入為 0 時為 null（顯示「不適用」）。 */
export function periodSummary(dataset, from, to) {
  let income = 0;
  let expense = 0;
  for (const t of dataset.transactions) {
    if (t.date < from || t.date > to) continue;
    if (t.type === 'income') income += t.amount;
    else if (t.type === 'expense') expense += t.amount;
  }
  const net = income - expense;
  return { income, expense, net, savingsRate: income > 0 ? net / income : null };
}
