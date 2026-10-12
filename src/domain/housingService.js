/** 購屋規劃寫入服務。 */
import { commit } from '../data/db.js';
import { makeRecord } from '../data/schema.js';
import { UserError } from './errors.js';

function normalize(input) {
  return {
    name: String(input.name ?? '').trim(),
    housePrice: input.housePrice,
    downPayment: input.downPayment,
    loanAmount: input.loanAmount,
    annualRate: input.annualRate,
    loanYears: input.loanYears,
    gracePeriodYears: input.gracePeriodYears,
    startMonth: input.startMonth || null,
    otherCosts: input.otherCosts,
    note: String(input.note ?? '').trim(),
  };
}

export function saveHousingPlan(db, id, input) {
  return commit(db, (ds) => {
    const fields = normalize(input);
    if (id) {
      const prev = ds.housingPlans.find((p) => p.id === id);
      if (!prev) throw new UserError('找不到此購屋規劃');
      return [{ op: 'put', collection: 'housingPlans', record: { ...prev, ...fields } }];
    }
    return [{ op: 'put', collection: 'housingPlans', record: makeRecord('housingPlans', fields) }];
  });
}

export function deleteHousingPlan(db, id) {
  return commit(db, (ds) => {
    if (!ds.housingPlans.some((p) => p.id === id)) throw new UserError('找不到此購屋規劃');
    return [{ op: 'delete', collection: 'housingPlans', id }];
  });
}
