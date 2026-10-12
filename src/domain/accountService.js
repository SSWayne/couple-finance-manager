/** 帳戶寫入服務。有交易或其他引用的帳戶不可刪除，請改為停用。 */
import { commit, findReferences, describeReferences } from '../data/db.js';
import { makeRecord } from '../data/schema.js';
import { UserError } from './errors.js';

function normalize(input) {
  const ownershipType = input.ownershipType === 'personal' ? 'personal' : 'shared';
  return {
    name: String(input.name ?? '').trim(),
    type: input.type,
    ownershipType,
    ownerMemberId: ownershipType === 'personal' ? input.ownerMemberId || null : null,
    openingBalance: input.openingBalance,
    openingDate: input.openingDate || null,
    note: String(input.note ?? '').trim(),
  };
}

function assertUniqueName(ds, name, exceptId) {
  if (ds.accounts.some((a) => a.id !== exceptId && a.name === name)) throw new UserError(`已有名為「${name}」的帳戶`);
}

export function createAccount(db, input) {
  return commit(db, (ds) => {
    const fields = normalize(input);
    assertUniqueName(ds, fields.name, null);
    const sortOrder = ds.accounts.reduce((m, a) => Math.max(m, a.sortOrder + 1), 0);
    return [{ op: 'put', collection: 'accounts', record: makeRecord('accounts', { ...fields, sortOrder }) }];
  });
}

export function updateAccount(db, id, input) {
  return commit(db, (ds) => {
    const prev = ds.accounts.find((a) => a.id === id);
    if (!prev) throw new UserError('找不到此帳戶');
    const fields = normalize(input);
    assertUniqueName(ds, fields.name, id);
    return [{ op: 'put', collection: 'accounts', record: { ...prev, ...fields } }];
  });
}

export function setAccountArchived(db, id, archived) {
  return commit(db, (ds) => {
    const prev = ds.accounts.find((a) => a.id === id);
    if (!prev) throw new UserError('找不到此帳戶');
    return [{ op: 'put', collection: 'accounts', record: { ...prev, archived } }];
  });
}

export function deleteAccount(db, id) {
  return commit(db, (ds) => {
    const prev = ds.accounts.find((a) => a.id === id);
    if (!prev) throw new UserError('找不到此帳戶');
    const refs = findReferences(ds, 'accounts', id);
    if (refs.length) throw new UserError(`「${prev.name}」仍被 ${describeReferences(refs)} 使用，不能刪除。請改用「停用」，舊紀錄會保留。`);
    return [{ op: 'delete', collection: 'accounts', id }];
  });
}
