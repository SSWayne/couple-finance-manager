# 架構說明（ARCHITECTURE）

## 總覽

```
index.html ── src/main.js（啟動、開資料庫、persist 請求）
                │
                ├─ app/      外框、路由、全域狀態、備份動作
                ├─ pages/    各頁面 render(ctx) → DOM
                ├─ ui/       h()、toast、dialog、共用元件、下載
                ├─ domain/   純商業邏輯（分攤、代墊、備份提醒）與寫入服務
                ├─ data/     schema（單一來源）、驗證、Dexie、備份還原、migrate、預設資料
                └─ lib/      金額、日期、ID 工具
```

- 純前端（Vite + Vanilla JS ES Module），無後端、無雲端、無第三方分析。
- 資料只存在使用者瀏覽器的 IndexedDB（Dexie）。不使用 localStorage／sessionStorage（ESLint 禁止）。
- 路由使用 hash（`#/settings`），URL 不放任何財務資料；頂部快速搜尋的文字透過記憶體傳給收支記帳頁，不寫入 URL。

## 資料流

1. 每次畫面渲染：`loadDataset()` 以**單一唯讀交易**讀出全部集合 → 傳給頁面 `render(ctx)`。
2. 每次寫入：`commit(db, ops)`
   - 開啟涵蓋全部資料表的讀寫交易
   - 讀出目前資料、在記憶體套用變更
   - 依 schema 做刪除前引用檢查（`findReferences`）
   - `validateDataset()` 驗證**整個**資料集（型別、未知欄位、關聯、商業規則、雙向一致）
   - 通過才寫入；任何例外 → 交易中止、整批回滾
3. 寫入完成發出 `data-changed` 事件 → 路由重繪目前頁面（保留捲動位置）。
4. 所有 UI 寫入動作都包在 `runAction()`：成功顯示綠色 toast，失敗顯示紅色 toast 並說明原因。

> 取捨：每次寫入都驗證整個資料集。以兩人家庭的資料量（每年數千筆）來說耗時為毫秒級，換來「資料庫永遠處於合法狀態」。若未來資料量大到有感，再改為增量驗證。

## 單一來源 schema（`src/data/schema.js`）

每個集合定義 `fields`（型別、nullable、預設值、ref/refList 關聯）、`rules`（單筆商業規則）、`indexes`（Dexie 索引）。以下全部由它自動推導：

| 用途 | 推導方式 |
| --- | --- |
| Dexie stores | `dexieStores()` |
| 新紀錄預設值 | `makeRecord()` |
| 欄位型別／未知欄位／必填 | `validateRecordShape()` |
| 關聯存在 | 走訪所有 `ref` / `refList` 欄位 |
| 刪除前引用檢查 | `referencingFields()` 反查所有指向該集合的欄位 |
| 匯出／匯入集合清單 | `COLLECTION_NAMES` |
| 「一筆交易只能被一個擁有者連結」 | 標記 `exclusiveLink: true` 的欄位 |

## 安全

- DOM 一律用 `h()` 建立，文字以 text node 加入；`h()` 拒絕 `innerHTML`/`outerHTML`/`srcdoc`，`href`/`src` 只允許安全協定。
- ESLint 禁止：`innerHTML`、`outerHTML`、`insertAdjacentHTML`、`document.write`、`eval`、`new Function`、`console.log`、`localStorage`、`sessionStorage`。
- 建置時以 Vite plugin 注入 CSP meta（開發模式不注入，因為 HMR 需要）：
  `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'`。
  沒有 `'unsafe-inline'`：動態樣式一律用 CSSOM（`el.style.setProperty`），CSP 允許。
- 字型（Inter latin 子集）與 Bootstrap Icons 皆由 npm 打包，不使用 CDN 或遠端字型；`scripts/check-dist.mjs` 會檢查 dist 中沒有外部網址。
- `navigator.storage.persist()` 啟動時呼叫但**不 await**（Firefox 會詢問使用者，await 會卡在載入中）。
- 匯入的 JSON 以 `Object.hasOwn` 檢查欄位，`__proto__`、`toString` 等名稱一律視為未知欄位拒絕。

## CSS 命名

- 一律 `cf-<元件>-<部位>`（例：`cf-sidebar-link-active`、`cf-backup-card-btn`），不定義與 Bootstrap 同名的 class（`card`、`container`、`nav`…）。
- Grid 欄位用 `minmax(0, 1fr)`，子項設 `min-width: 0`，避免橫向捲動區或長字串撐寬欄位。
- 不用 `overflow-x: hidden` 掩蓋溢出；截圖腳本以 `scrollWidth > clientWidth` 實測。

## 需求未定義時的決定（選安全、不遺失資料的做法）

| 情境 | 決定 | 理由 |
| --- | --- | --- |
| 匯入 | 只支援完整覆蓋，不做合併 | 合併兩份帳本容易產生重複與不一致 |
| 匯入前 | 必須勾選確認，並提供「先下載目前備份」 | 避免誤蓋資料 |
| 結構錯誤的備份 | 先回報結構錯誤，不再跑商業規則 | 避免一個錯誤引發大量連鎖誤報 |
| 分類可修改的欄位 | 只有名稱、圖示、顏色；類型與上層分類建立後不可改 | 避免舊交易的分類意義改變 |
| 封存主分類 | 一併封存其子分類；取消封存子分類前主分類必須是啟用的 | 避免出現「主分類停用但子分類可選」 |
| 系統分類（禮金、婚禮、房貸、其他） | 不可刪除，可改名 | 其他功能依賴這些固定 ID |
| 成員 | 固定 `member-self`／`member-partner`，只能改名 | 依需求 |
| 收入 | 可標記個人或共同，但不分攤 | 分攤與代墊只對支出有意義 |
| 轉帳 | 不設定歸屬、不分攤、不可結算 | 轉帳不算收支 |
| 「上次備份時間」 | 記錄的是觸發下載的時間，介面明確說明不等於已保存 | 瀏覽器無法得知檔案是否真的存下 |
| 匯入後的 lastBackupAt | 沿用備份檔內的值 | 備份檔就是那個時間點的完整狀態 |
| 自訂比例分攤 | 只儲存 shares（整數金額），比例在表單由 shares 推算 | 金額才是事實來源，避免比例與金額不一致 |
| 金額格式 | 整數新台幣元；settings 記錄 `currency`/`currencyExponent` | 未來升級多幣別時由 `migrate()` 轉換 |
| Bootstrap JS | 不使用；對話框用原生 `<dialog>`、抽屜自行實作 | 少一個依賴（Popper），且與 CSP 相容 |
| 期初餘額與期初日期 | 期初餘額是記帳前的餘額，所有交易都計入；期初日期只作紀錄 | 避免使用者補記舊交易時餘額「消失」 |
| 結算範圍 | 結算日當天以前所有未結算代墊，不能挑選部分交易 | 依需求「互相抵銷後一次結清」，也避免漏結 |
| 已結算交易 | 鎖定類型／金額／付款人／歸屬／分攤，帳戶、分類、日期、說明仍可改 | 這些欄位不影響代墊金額 |
| 由其他功能產生的交易（結算轉帳、禮金、撥款） | 收支記帳只能改說明、標籤、付款方式；刪除要回原功能 | 避免兩邊資料不一致 |
| 停用帳戶、封存分類 | 新交易不能選；舊交易保留原值，編輯時仍可保留 | 不改動歷史資料 |
| 帳戶名稱 | 不可重複 | 避免下拉選單分不清 |
| 篩選狀態 | 只存在記憶體，不放 URL、不存 localStorage | URL 不放財務資料 |
| 快速記帳（＋、新增記帳） | 任何頁面都直接開表單，不換頁；沒有帳戶時先引導到帳戶管理 | 減少操作步驟 |
| 手機版交易列 | 點整列開修改表單，刪除按鈕在表單內 | 清單更緊湊、避免誤觸刪除 |
| 圖表期間 | 存在 settings.dashboardPeriod，切換時提示「已記住」 | 遵守「每次修改都提示」，也讓換裝置匯入後保留偏好 |
| 3 個月圖表 | 13 組「每 7 天」而非日曆週 | 最後一組固定到今天，不會出現半週 |
| 圖表預設強調 | 今天以前最近一個有收支的區間 | 避免預設停在沒有資料的今天 |
| 結餘線 | monotone 插值 | 一般曲線在 0 元附近會往下彎，看起來像負值 |
| 個人預算 | 只算該成員的個人支出，不含共同支出分攤 | 依需求「該成員個人支出」 |
| 複製上月預算 | 略過本月已存在的範圍與已封存分類 | 不覆蓋使用者已調整的預算 |
| Chart.js | 按需註冊並以動態 import 拆成獨立檔案，只有財務總覽載入 | 其他頁面不需下載圖表程式 |
| 半圓儀表 | 用 SVG 繪製（不用 Chart.js） | 尺寸固定、清晰，且不需額外註冊 doughnut |
| 視窗高度 < 820px | Sidebar 不固定、跟著頁面捲動 | 避免底部備份卡被裁切 |
| 刪除婚禮專案 | 有已入帳禮金或關聯交易時拒絕；否則刪除專案、項目、未入帳禮金 | 不連帶刪除家庭帳本資料 |
| 刪除婚禮項目 | 有關聯交易時拒絕，請先在交易中取消關聯 | 不留下指向不存在項目的交易 |
| 禮金交易的付款人 | 對方賓客記在另一半、其他記在我；之後修改禮金不改付款人 | 交易一定要有付款人；使用者可在收支記帳改 |
| 禮金交易歸屬 | 共同收入 | 禮金屬於兩人 |
| 婚禮項目關聯欄位 | 交易表單只在有婚禮項目時顯示；舊的呼叫端不帶此欄位時不覆蓋原值 | 避免無意間解除關聯 |
| 房貸試算 | 不儲存攤還表，每次即時計算 | 參數改了就自動更新，不會不一致 |
| 房貸收入比的收入 | 近 3 個完整月平均（不含本月），不足 3 個月照樣除以 3 | 避免本月未過完拉低平均；保守估算 |
| 固定收支的開始日在過去 | 從開始日補產生到今天，表單會先提示筆數 | 使用者自己選的開始日；先提示避免意外 |
| 新增／修改固定收支後 | 立即檢查一次到期項目 | 網站本來就開著；不用等下次開啟 |
| 刪除固定收支範本 | 保留已產生交易、解除關聯 | 不刪除帳本資料 |
| 暫停期間錯過、但暫停前就到期未產生的項目 | 恢復時一併略過（skipBefore＝恢復當天） | 依需求「不補產生暫停期間」，規則單純 |
| 固定收支產生的交易 | 是一般交易，可在收支記帳修改或刪除；刪除後下次檢查會補回 | 防重複只看 (範本, 日期)；要永久不產生請暫停或改結束日 |
| 刪除儲蓄目標 | 有撥款紀錄時拒絕，改用封存 | 避免連帶刪除實際轉帳 |
| 撥款金額預設 | 帶入每月建議 | 減少輸入 |
| 報表 | 全部即時計算、不儲存；篩選只在記憶體 | 不會與帳本不一致；URL 不放財務資料 |
| 表格捲動框 | position: relative | 表格內絕對定位的隱藏文字曾跑出捲動框撐寬手機頁面 |
| CI 的 Node 版本 | 22（LTS） | 本機開發用 24；兩者都符合 Vite 8 的需求 |
| CI 先檢查 lockfile | check:lockfile 在 
pm ci 之前執行 | 確保只從 registry.npmjs.org 安裝 |
| Pages 部署 | 只有 push 到 main 才上傳 artifact 與部署；PR 只檢查 | 依需求 |
| commit 作者 | 只在本專案設定 git config user.email 為 GitHub noreply 信箱 | 不暴露私人信箱、不影響其他專案 |
