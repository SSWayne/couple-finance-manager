import { app } from './state.js';
import { backupFileName, buildBackup, serializeBackup } from '../data/backup.js';
import { markBackupExported } from '../domain/settingsService.js';
import { downloadText } from '../ui/download.js';
import { toast, explainError } from '../ui/toast.js';

/** 匯出完整備份並觸發下載。回傳是否成功觸發。 */
export async function exportBackupNow() {
  try {
    const now = new Date();
    const backup = await buildBackup(app.db, now);
    downloadText(backupFileName(now), serializeBackup(backup));
    await markBackupExported(app.db, now.toISOString());
    toast.success('已觸發下載備份檔。請到下載資料夾確認檔案存在，並另外保存到雲端硬碟或隨身碟。');
    return true;
  } catch (err) {
    toast.error(`備份匯出失敗：${explainError(err).message}`);
    console.error(err);
    return false;
  }
}
