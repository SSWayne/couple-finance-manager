/**
 * 房貸試算（純函式，結果標示為估算）。
 *
 * - 本息平均攤還＋寬限期（寬限期內只繳利息）。
 * - 每月利息＝剩餘本金 × 月利率，四捨五入到元。
 * - 寬限期後月付金＝本金 × r(1+r)^m ÷ ((1+r)^m − 1)，四捨五入到元（利率 0 時＝本金 ÷ 期數）。
 * - 每期本金＝月付金 − 當期利息；最後一期結清剩餘本金（因四捨五入，最後一期金額可能略有不同）。
 * - 房貸收入比＝寬限期後月付金 ÷ 近 3 個完整月的平均月收入；超過 1/3 提醒。
 */
import { addMonthsToMonth } from '../lib/date.js';
import { periodSummary } from './balances.js';
import { monthRange } from './budgets.js';

export const MORTGAGE_RATIO_LIMIT = 1 / 3;

export function amortizedPayment(principal, annualRatePercent, months) {
  if (months <= 0 || principal <= 0) return 0;
  const r = annualRatePercent / 100 / 12;
  if (r === 0) return Math.round(principal / months);
  const f = (1 + r) ** months;
  return Math.round((principal * r * f) / (f - 1));
}

/**
 * @returns {{ rows: {period:number, month:string|null, payment:number, interest:number, principal:number, balance:number, grace:boolean}[],
 *            gracePayment:number, monthlyPayment:number, totalInterest:number, totalPayment:number, months:number, graceMonths:number }}
 */
export function amortizationSchedule({ loanAmount, annualRate, loanYears, gracePeriodYears = 0, startMonth = null }) {
  const n = loanYears * 12;
  const g = Math.min(gracePeriodYears * 12, Math.max(0, n - 1));
  const r = annualRate / 100 / 12;
  const rows = [];
  let balance = loanAmount;
  const payment = amortizedPayment(loanAmount, annualRate, n - g);
  let totalInterest = 0;
  let totalPayment = 0;
  for (let p = 1; p <= n && loanAmount > 0; p++) {
    const interest = Math.round(balance * r);
    let principal;
    let pay;
    if (p <= g) {
      principal = 0;
      pay = interest;
    } else if (p === n) {
      principal = balance;
      pay = interest + principal;
    } else {
      principal = Math.min(balance, payment - interest);
      pay = interest + principal;
    }
    balance -= principal;
    totalInterest += interest;
    totalPayment += pay;
    rows.push({ period: p, month: startMonth ? addMonthsToMonth(startMonth, p - 1) : null, payment: pay, interest, principal, balance, grace: p <= g });
  }
  return {
    rows,
    gracePayment: g > 0 && rows.length ? rows[0].payment : 0,
    monthlyPayment: payment,
    totalInterest,
    totalPayment,
    months: n,
    graceMonths: g,
  };
}

/** 近 3 個「完整」月（不含本月）的平均月收入。 */
export function averageMonthlyIncome(dataset, today, months = 3) {
  const thisMonth = today.slice(0, 7);
  let total = 0;
  const list = [];
  for (let i = 1; i <= months; i++) {
    const m = addMonthsToMonth(thisMonth, -i);
    const [from, to] = monthRange(m);
    const income = periodSummary(dataset, from, to).income;
    total += income;
    list.push({ month: m, income });
  }
  return { average: Math.round(total / months), months: list.reverse() };
}

export function mortgageIncomeRatio(dataset, plan, today) {
  const schedule = amortizationSchedule(plan);
  const { average, months } = averageMonthlyIncome(dataset, today);
  const ratio = average > 0 ? schedule.monthlyPayment / average : null;
  return { monthlyPayment: schedule.monthlyPayment, averageIncome: average, incomeMonths: months, ratio, overLimit: ratio !== null && ratio > MORTGAGE_RATIO_LIMIT };
}

/** 依年份彙總攤還表（畫面顯示用）。 */
export function yearlySummary(rows) {
  const out = [];
  for (const row of rows) {
    const year = Math.ceil(row.period / 12);
    let y = out[year - 1];
    if (!y) {
      y = { year, payment: 0, interest: 0, principal: 0, endBalance: 0, grace: true, fromMonth: row.month, toMonth: row.month };
      out.push(y);
    }
    y.payment += row.payment;
    y.interest += row.interest;
    y.principal += row.principal;
    y.endBalance = row.balance;
    y.grace = y.grace && row.grace;
    y.toMonth = row.month;
  }
  return out;
}
