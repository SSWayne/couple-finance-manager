/** UUID v4；系統預設資料改用可讀固定 ID（例如 member-self、cat-exp-food）。 */
export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 允許 UUID 與可讀固定 ID（小寫英數與連字號）。 */
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isValidId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value);
}
