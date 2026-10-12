/** 使用者可理解、可自行修正的錯誤（訊息直接顯示在 toast）。 */
export class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
  }
}
