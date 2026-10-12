# 資料模型（DATA_MODEL）

唯一定義來源：[`src/data/schema.js`](src/data/schema.js)。本文件是說明，若與程式不一致以程式為準。

- 資料格式版本 `SCHEMA_VERSION = 1`；IndexedDB 名稱 `couple-finance-manager`。
- 所有紀錄**必須包含 schema 定義的每一個欄位**（可為 null 的用 null），且**不可有未知欄位**。
- 金額：`Number.isSafeInteger` 的整數新台幣元。交易金額恆正，方向由 `type` 決定。
- ID：UUID v4；系統預設資料用可讀固定 ID（`member-self`、`cat-exp-food`）。格式 `^[a-z0-9][a-z0-9-]{0,63}$`。
- 日期 `YYYY-MM-DD`、月份 `YYYY-MM`、時間戳 ISO 8601（`createdAt`、`updatedAt` 由寫入層自動維護）。

## 集合（14 個）

| 集合 | 型態 | 說明 |
| --- | --- | --- |
| members | 清單（固定 2 筆） | `member-self`（我）、`member-partner`（另一半），只能改名 |
| accounts | 清單 | 帳戶；餘額不儲存，＝期初餘額＋交易推算 |
| categories | 清單 | 收入／支出分類，最多一層子分類 |
| transactions | 清單 | 收入、支出、轉帳 |
| budgets | 清單 | 月預算（家庭總／個人／共同／分類） |
| settlements | 清單 | 代墊結算 |
| weddingProject | 單一物件或 null | 婚禮專案（固定 ID `wedding-project`） |
| weddingExpenses | 清單 | 婚禮項目（規劃層，不是交易） |
| weddingGifts | 清單 | 禮金 |
| housingPlans | 清單 | 購屋規劃與房貸試算參數 |
| savingsGoals | 清單 | 儲蓄目標 |
| savingsContributions | 清單 | 儲蓄撥款（正數撥入、負數提回） |
| recurringTransactions | 清單 | 固定收支範本 |
| settings | 單一物件 | 設定（固定 ID `settings`） |

## 主要欄位

### transactions

| 欄位 | 型別 | 規則 |
| --- | --- | --- |
| date | date | 必填 |
| type | `income` / `expense` / `transfer` | |
| amount | money ≥ 1 | |
| categoryId / subcategoryId | ref categories | 收支必填主分類；子分類的 parentId 必須等於 categoryId；轉帳必須為 null |
| accountId | ref accounts | 必填 |
| toAccountId | ref accounts | 只有轉帳，且不可等於 accountId |
| memberId | ref members | 付款人（收入為收款人） |
| ownershipType | `personal` / `shared` / null | 收支必填；轉帳為 null |
| ownerMemberId | ref members | 個人收支必填；共同為 null |
| splitMode | `none` / `equal` / `ratio` / `amount` | 個人、收入、轉帳為 none；共同支出不可為 none |
| shares | `{ 成員ID: 整數 }` 或 null | 共同支出必填，兩位成員都要有、加總＝金額；equal 時零頭給付款人 |
| paymentMethod | 列舉或 null | |
| description | 文字 ≤ 200 | |
| tags | 文字陣列 ≤ 10 個、每個 ≤ 20 字 | 不可重複 |
| settlementId | ref settlements | 只有有代墊的支出可設定；必須與結算的 transactionIds 雙向一致 |
| recurringId + recurringDate | ref + date | 必須同時存在或同時為 null；(recurringId, recurringDate) 唯一 |
| weddingExpenseId | ref weddingExpenses | 只有支出 |

### 其他集合的連結

- `settlements.transactionIds`（refList）＋ `transferTransactionId`（結算轉帳）。金額必須等於所含交易的代墊淨額，方向一致。
- `weddingGifts.accountId` ＋ `transactionId`：必須同時存在；交易必須是「禮金」（`cat-inc-gift`）收入，金額、帳戶、日期一致。
- `savingsContributions.fromAccountId` ＋ `transferTransactionId`：必須同時存在；交易必須是從轉出帳戶到目標帳戶的轉帳，金額一致。
- 一筆交易最多只能被一個「擁有者」（結算轉帳／禮金／撥款轉帳）連結。

## 整個資料集的規則

- 成員剛好兩位且 ID 固定。
- 同月份、同範圍（scope + 成員 + 分類）的預算不可重複。
- 固定收支 (recurringId, recurringDate) 不可重複（IndexedDB 也有唯一複合索引 `&[recurringId+recurringDate]`）。
- 有婚禮項目或禮金時必須有婚禮專案。
- 每個儲蓄目標依日期累計的撥款不可為負（不可提回超過已累積）。

## 預設資料

首次建立資料庫時寫入：兩位成員、12 個支出主分類（餐飲、交通、居住含子分類）、5 個收入分類、預設設定（備份提醒 7 天）。系統分類 `cat-inc-gift`、`cat-exp-wedding`、`cat-exp-mortgage`、`cat-exp-other`、`cat-inc-other` 不可刪除。

## 升級

提升 `SCHEMA_VERSION` → Dexie 加 `this.version(n)` → 在 `src/data/migrate.js` 的 `MIGRATIONS[n-1]` 寫轉換函式（舊備份匯入時也會經過它）。
