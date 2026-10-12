/**
 * 儲蓄目標進度（純函式）。撥款只是標記，不算支出、不增加資產。
 * 每月建議＝⌈剩餘金額 ÷ 剩餘月數⌉（剩餘月數至少 1）。
 */
import { parseDate } from '../lib/date.js';

export function goalSaved(dataset, goalId) {
  return dataset.savingsContributions.filter((c) => c.goalId === goalId).reduce((s, c) => s + c.amount, 0);
}

/** 從 today 到 targetDate 還有幾個月（含當月，至少 1）；無目標日期回傳 null。 */
export function monthsLeft(targetDate, today) {
  if (!targetDate) return null;
  const a = parseDate(today);
  const b = parseDate(targetDate);
  const months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1;
  return Math.max(1, months);
}

export function goalProgress(dataset, goal, today) {
  const saved = goalSaved(dataset, goal.id);
  const remaining = Math.max(0, goal.targetAmount - saved);
  const left = monthsLeft(goal.targetDate, today);
  const overdue = Boolean(goal.targetDate && goal.targetDate < today && remaining > 0);
  return {
    goal,
    saved,
    remaining,
    ratio: Math.min(1, saved / goal.targetAmount),
    monthsLeft: left,
    overdue,
    monthlySuggestion: remaining > 0 && left ? Math.ceil(remaining / left) : 0,
  };
}

export function activeGoalProgress(dataset, today) {
  return dataset.savingsGoals
    .filter((g) => g.status === 'active')
    .map((g) => goalProgress(dataset, g, today))
    .sort((a, b) => (a.goal.targetDate ?? '9999').localeCompare(b.goal.targetDate ?? '9999'));
}
