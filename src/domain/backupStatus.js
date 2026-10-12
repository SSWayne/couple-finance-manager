/** 備份提醒狀態（純函式）。 */
export function backupStatus(settings, now = new Date()) {
  const days = settings.backupReminderDays;
  if (!settings.lastBackupAt) {
    return { level: 'warning', daysSince: null, reminderDays: days, text: '尚未匯出過備份' };
  }
  const daysSince = Math.floor((now - new Date(settings.lastBackupAt)) / 86400000);
  if (daysSince >= days) {
    return { level: 'warning', daysSince, reminderDays: days, text: `已 ${daysSince} 天未備份（提醒天數 ${days} 天）` };
  }
  return { level: 'ok', daysSince, reminderDays: days, text: daysSince === 0 ? '今天已匯出備份' : `${daysSince} 天前匯出備份` };
}
