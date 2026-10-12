/**
 * 婚禮基金（純函式）。婚禮項目是「規劃層」，不是交易：
 * - 已付款＝手動記錄（未入家庭帳本，例如長輩代付）＋關聯交易金額合計
 * - 費用＝實際金額（沒有填則用預估）
 * - 未付＝max(0, 費用 − 已付款)
 * - 淨支出＝總費用 − 禮金合計
 */

export const DEFAULT_WEDDING_ITEMS = ['婚宴', '婚紗攝影', '婚戒', '喜餅', '新娘秘書', '婚禮佈置', '喜帖', '蜜月', '其他'];

export function itemCost(item) {
  return item.actualAmount ?? item.estimatedAmount;
}

export function linkedTransactions(dataset, itemId) {
  return dataset.transactions.filter((t) => t.weddingExpenseId === itemId);
}

export function itemSummary(dataset, item) {
  const txs = linkedTransactions(dataset, item.id);
  const linkedPaid = txs.reduce((s, t) => s + t.amount, 0);
  const paid = item.manualPaidAmount + linkedPaid;
  const cost = itemCost(item);
  return { item, txs, linkedPaid, paid, cost, unpaid: Math.max(0, cost - paid), overpaid: Math.max(0, paid - cost), usesActual: item.actualAmount !== null };
}

export function weddingSummary(dataset) {
  const items = [...dataset.weddingExpenses].sort((a, b) => a.sortOrder - b.sortOrder).map((i) => itemSummary(dataset, i));
  const totalEstimated = dataset.weddingExpenses.reduce((s, i) => s + i.estimatedAmount, 0);
  const totalCost = items.reduce((s, x) => s + x.cost, 0);
  const totalPaid = items.reduce((s, x) => s + x.paid, 0);
  const totalManual = items.reduce((s, x) => s + x.item.manualPaidAmount, 0);
  const totalUnpaid = items.reduce((s, x) => s + x.unpaid, 0);
  const gifts = [...dataset.weddingGifts].sort((a, b) => b.date.localeCompare(a.date) || a.giverName.localeCompare(b.giverName));
  const totalGifts = gifts.reduce((s, g) => s + g.amount, 0);
  const giftsBySide = { self: 0, partner: 0, both: 0 };
  for (const g of gifts) giftsBySide[g.side] += g.amount;
  const budget = dataset.weddingProject?.totalBudget ?? 0;
  return {
    project: dataset.weddingProject,
    items,
    gifts,
    totalEstimated,
    totalCost,
    totalPaid,
    totalManual,
    totalUnpaid,
    totalGifts,
    giftsBySide,
    netExpense: totalCost - totalGifts,
    budget,
    budgetRemaining: budget - totalCost,
  };
}
