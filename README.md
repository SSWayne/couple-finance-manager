# 我們的小金庫（Couple Finance Manager）

雙人家庭財務管理系統：日常收支、共同生活費、代墊結算、婚禮預算、購屋與房貸、儲蓄目標、固定收支、財務報表。

- **純前端**：沒有後端、沒有雲端資料庫、沒有第三方分析。
- **資料只存在你的瀏覽器**（IndexedDB），每次新增、修改、刪除都立即自動儲存。
- 不同裝置、不同瀏覽器之間**不會同步**；請定期在「系統設定」匯出 JSON 備份（詳見 [BACKUP_RESTORE.md](BACKUP_RESTORE.md)）。

---

## 1. 安裝 Node.js

到 <https://nodejs.org> 下載 **LTS 版（20 以上）** 並安裝。安裝後開一個新的終端機確認：

```bash
node -v
```

## 2. 啟動

**Windows**：雙擊專案資料夾裡的 `一鍵開啟.bat`。它會：

1. 檢查 Node.js 是否安裝、版本是否 20 以上
2. 第一次使用或套件不完整時自動執行 `npm install`
3. 啟動網站並自動用瀏覽器開啟（使用期間請保持黑色視窗開著）

**手動**（任何作業系統）：

```bash
npm install
```

```bash
npm run dev
```

## 3. 測試與檢查

```bash
npm test
```

```bash
npm run lint
```

一次跑完 CI 會做的所有檢查（lockfile、lint、測試、建置、dist 檢查）：

```bash
npm run ci
```

- 測試使用 Vitest + fake-indexeddb，每個測試都是獨立的資料庫，**不會碰到你的真實資料**。
- 完整整合測試（`tests/integration.test.js`）可以輸出一份測試資料備份檔，用來在畫面上匯入檢查：

```bash
CF_INTEGRATION_OUT=test-output/integration-backup.json npx vitest run tests/integration.test.js
```

（Windows PowerShell：`$env:CF_INTEGRATION_OUT='test-output\integration-backup.json'; npx vitest run tests/integration.test.js`）

## 4. 建置

```bash
npm run build
```

部署到子路徑（例如 GitHub Pages 的 `/REPO/`）時，用 `BASE_PATH` 指定，並執行建置後檢查：

```bash
BASE_PATH=/REPO/ npm run build
```

```bash
BASE_PATH=/REPO/ npm run check:dist
```

（Windows PowerShell：`$env:BASE_PATH='/REPO/'; npm run build; npm run check:dist`）

`check:dist` 會檢查：所有資源都在子路徑下、有注入 CSP、沒有 inline script、沒有外部網址（CDN、遠端字型）。

---

## 5. 部署到 GitHub Pages

### 5.1 安裝 Git 並設定作者

到 <https://git-scm.com/download/win> 安裝 Git。為了不在公開 repo 暴露私人信箱，commit 作者請使用 GitHub 的 **noreply 信箱**：

1. 到 GitHub → Settings → Emails，勾選「Keep my email addresses private」，畫面上會顯示你的 noreply 信箱，格式像 `12345678+你的帳號@users.noreply.github.com`。
2. 在專案資料夾設定（只影響這個專案）：

```bash
git config user.name "你的 GitHub 帳號"
```

```bash
git config user.email "12345678+你的帳號@users.noreply.github.com"
```

### 5.2 建立 repo 並推上去

1. 在 GitHub 建立一個新的 repository（例如 `couple-finance`）。可以選 Private；免費方案的 Private repo 無法使用 GitHub Pages，需改 Public 或使用付費方案。
2. 在專案資料夾執行（把網址換成你的 repo）：

```bash
git init -b main
```

```bash
git add .
```

```bash
git commit -m "我們的小金庫：初始版本"
```

```bash
git remote add origin https://github.com/你的帳號/couple-finance.git
```

```bash
git push -u origin main
```

`.gitignore` 已排除 `node_modules`、`dist`、備份 JSON（`couple-finance-backup-*.json`）與所有 CSV，**不會把你的財務資料推上去**。推之前可以用 `git status` 再確認一次。

### 5.3 設定 Pages Source 為 GitHub Actions

1. repo → **Settings** → **Pages**
2. **Build and deployment → Source** 選 **GitHub Actions**

### 5.4 確認部署

1. repo → **Actions**，會看到「CI / Deploy」正在執行：`check:lockfile → npm ci → lint → test → build（BASE_PATH=/repo 名稱/）→ check:dist → 部署`。
2. 全部綠勾後，網址是 `https://你的帳號.github.io/couple-finance/`（Settings → Pages 也會顯示）。
3. 之後每次 push 到 `main` 都會自動重新部署；**Pull Request 只會檢查與建置，不會部署**。

> 部署後的網站和本機網站是不同網址，瀏覽器會把它們當成不同網站，資料不互通。要搬資料請用「匯出備份 → 匯入還原」。

---

## 6. 使用前一定要知道

- 資料只存在「這台裝置的這個瀏覽器」。清除瀏覽資料、移除網站資料或重灌，資料就會消失。
- 匯入備份是**完整覆蓋**，不會合併；兩人在不同裝置記帳時，後匯入的會蓋掉另一方。
- 固定收支只在**開啟網站時**補入帳到期項目，網站關閉期間不會執行。
- 房貸試算為估算，實際以銀行核貸條件為準。

## 7. 文件

| 文件 | 內容 |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 架構、資料流、安全、CSS 命名、需求未定義時的決定 |
| [DATA_MODEL.md](DATA_MODEL.md) | 14 個集合與欄位規則 |
| [FINANCIAL_RULES.md](FINANCIAL_RULES.md) | 餘額、分攤、代墊、結算、預算、婚禮、房貸、儲蓄、固定收支、報表的計算規則 |
| [BACKUP_RESTORE.md](BACKUP_RESTORE.md) | 備份與還原、跨裝置使用 |
| [TEST_REPORT.md](TEST_REPORT.md) | 測試範圍與結果 |
| [DEVELOPMENT_PROGRESS.md](DEVELOPMENT_PROGRESS.md) | 各階段開發紀錄 |

## 8. 技術

Vite 8、Vanilla JS（ES Module）、Bootstrap 5（只用 CSS）、Bootstrap Icons、Chart.js 4（按需註冊、獨立載入）、Dexie 4（IndexedDB）、Inter（@fontsource，latin 子集）、Vitest + fake-indexeddb、ESLint。
