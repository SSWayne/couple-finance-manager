/**
 * 共同支出分攤與代墊計算（純函式，schema 驗證與畫面共用）。
 *
 * 規則：
 * - 共同支出 shares = { 成員ID: 應負擔整數 }，加總必須等於金額。
 * - 平均分攤與比例分攤的零頭由付款人負擔。
 * - 代墊 = 付款人替對方付了對方應負擔的部分。
 * - 幫另一半付她／他的個人支出 = 全額代墊。
 */

export const MEMBER_SELF = 'member-self';
export const MEMBER_PARTNER = 'member-partner';
export const MEMBER_IDS = [MEMBER_SELF, MEMBER_PARTNER];

export function otherMember(memberId) {
  return memberId === MEMBER_SELF ? MEMBER_PARTNER : MEMBER_SELF;
}

/** 50/50：非付款人負擔 floor(金額/2)，零頭給付款人。 */
export function equalShares(amount, payerId) {
  const other = otherMember(payerId);
  const otherShare = Math.floor(amount / 2);
  return { [payerId]: amount - otherShare, [other]: otherShare };
}

/**
 * 自訂比例：ratio 為付款人以外那位成員負擔的百分比（0–100，可有小數）。
 * 為避免浮點誤差，先換算成萬分比整數再運算；零頭給付款人。
 */
export function ratioShares(amount, payerId, ratioByMember) {
  const other = otherMember(payerId);
  const otherPct = Number(ratioByMember[other]);
  const payerPct = Number(ratioByMember[payerId]);
  if (!Number.isFinite(otherPct) || !Number.isFinite(payerPct)) return null;
  const otherBp = Math.round(otherPct * 100);
  const payerBp = Math.round(payerPct * 100);
  if (otherBp < 0 || payerBp < 0 || otherBp + payerBp !== 10000) return null;
  const otherShare = Math.floor((amount * otherBp) / 10000);
  return { [payerId]: amount - otherShare, [other]: otherShare };
}

export function sumShares(shares) {
  return Object.values(shares || {}).reduce((a, b) => a + b, 0);
}

/**
 * 計算單筆交易的代墊。回傳 { creditorId, debtorId, amount } 或 null。
 * creditor = 付款人（墊錢的人），debtor = 應償還的人。
 */
export function computeAdvance(tx) {
  if (!tx || tx.type !== 'expense') return null;
  const payer = tx.memberId;
  if (tx.ownershipType === 'personal') {
    if (tx.ownerMemberId && tx.ownerMemberId !== payer) {
      return { creditorId: payer, debtorId: tx.ownerMemberId, amount: tx.amount };
    }
    return null;
  }
  if (tx.ownershipType === 'shared' && tx.shares) {
    const debtor = otherMember(payer);
    const owed = tx.shares[debtor] ?? 0;
    if (owed > 0) return { creditorId: payer, debtorId: debtor, amount: owed };
  }
  return null;
}

/**
 * 某成員對單筆支出的實際負擔金額（個人報表、個人預算用）。
 * 個人支出：歸屬人負擔全額；共同支出：依 shares。
 */
export function memberBurden(tx, memberId) {
  if (tx.type !== 'expense') return 0;
  if (tx.ownershipType === 'personal') return tx.ownerMemberId === memberId ? tx.amount : 0;
  if (tx.ownershipType === 'shared') return tx.shares?.[memberId] ?? 0;
  return 0;
}

/**
 * 多筆代墊互相抵銷後的淨額。
 * 回傳 { fromMemberId, toMemberId, amount }；amount 為 0 代表互相抵銷完畢。
 */
export function netAdvances(transactions) {
  // balance > 0：partner 欠 self；balance < 0：self 欠 partner
  let balance = 0;
  for (const tx of transactions) {
    const adv = computeAdvance(tx);
    if (!adv) continue;
    if (adv.debtorId === MEMBER_PARTNER) balance += adv.amount;
    else balance -= adv.amount;
  }
  if (balance > 0) return { fromMemberId: MEMBER_PARTNER, toMemberId: MEMBER_SELF, amount: balance };
  if (balance < 0) return { fromMemberId: MEMBER_SELF, toMemberId: MEMBER_PARTNER, amount: -balance };
  return { fromMemberId: MEMBER_PARTNER, toMemberId: MEMBER_SELF, amount: 0 };
}
