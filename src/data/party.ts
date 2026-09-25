import { type NormalizedEvent, type Query, queryParty } from './contract.js';

export type PartyAssessment = { total: number | null; knownSubtotal: number; lowerBound: number;
  unresolved: string[]; admission: 'MATCH' | 'UNKNOWN' | 'MISMATCH'; admissionNotes: string[] };
// Общий evaluator. Renderer получает этот результат и не выбирает тариф заново.
export function assessParty(e: NormalizedEvent, q: Query): PartyAssessment {
  const p = queryParty(q), r: PartyAssessment = { total: null, knownSubtotal: 0, lowerBound: 0, unresolved: [], admission: 'MATCH', admissionNotes: [] };
  const unit = (audience: 'ADULT' | 'CHILD', age: number | null) => {
    const tariffs = e.tariffs?.filter(t => t.audience === audience) ?? [];
    const possible = tariffs.filter(t => audience === 'ADULT' || age === null || (age >= (t.minAge ?? 0) && age <= (t.maxAge ?? 17)));
    const applies = possible.filter(t => t.applicable && (audience === 'ADULT' || age !== null || (t.minAge ?? 0) === 0 && (t.maxAge ?? 17) === 17));
    if (possible.length === 1 && applies.length === 1) {
      const t = applies[0]!;
      if (['EXACT','FREE'].includes(t.kind) && t.amount !== null) { r.knownSubtotal += t.amount; r.lowerBound += t.amount; return; }
      if (t.kind === 'FROM' && t.lowerBound !== null) r.lowerBound += t.lowerBound;
    } else if (!tariffs.length && audience === 'ADULT') {
      if (e.price.applicability === 'SINGLE_ADULT' && ['EXACT','FREE'].includes(e.price.kind) && e.price.amount !== null && e.price.currency === 'RUB') {
        r.knownSubtotal += e.price.amount; r.lowerBound += e.price.amount; return;
      }
      if(e.price.applicability==='SINGLE_ADULT'&&e.price.kind==='FROM'&&e.price.currency==='RUB'&&e.price.lowerBound!==null)r.lowerBound+=e.price.lowerBound;
    }
    r.unresolved.push(audience === 'ADULT' ? 'Взрослый тариф не установлен или условен.' : age === null ? 'Цена ребёнка: возраст или применимый тариф неизвестны.' : `Цена ребёнка ${age} лет не установлена или условна.`);
  };
  for (let i = 0; i < p.adults; i++) unit('ADULT', null);
  for (const age of p.childAges) unit('CHILD', age);
  // Старый FROM даёт нижнюю границу для хотя бы одного посетителя, не выдуманный семейный тариф.
  if (!e.tariffs?.some(t => t.audience === 'ADULT') && e.price.kind === 'FROM' && e.price.currency === 'RUB' && e.price.lowerBound !== null)
    r.lowerBound = Math.max(r.lowerBound, e.price.lowerBound);
  if (!r.unresolved.length) r.total = r.knownSubtotal;
  r.unresolved = [...new Set(r.unresolved)];
  const rules = e.admission.requirements;
  if (rules?.minimumAge !== null && rules?.minimumAge !== undefined && rules.minimumAge > 18) {
    r.admission = 'UNKNOWN'; r.admissionNotes.push(`Допуск с ${rules.minimumAge} лет: возраст взрослых не запрашивался.`);
  }
  if (p.childAges.length) {
    if (!rules || rules.children === 'UNKNOWN') { r.admission = 'UNKNOWN'; r.admissionNotes.push('Допуск детей не установлен.'); }
    else if (rules.children === 'PROHIBITED') { r.admission = 'MISMATCH'; r.admissionNotes.push('Источник не допускает детей.'); }
    if (rules?.minimumAge !== null && rules?.minimumAge !== undefined) {
      if (p.childAges.some(a => a !== null && a < rules.minimumAge!)) { r.admission = 'MISMATCH'; r.admissionNotes.push(`Допуск только с ${rules.minimumAge} лет.`); }
      else if (rules.minimumAge > 0 && p.childAges.includes(null) && r.admission !== 'MISMATCH') { r.admission = 'UNKNOWN'; r.admissionNotes.push(`Для допуска с ${rules.minimumAge} лет нужен возраст детей.`); }
    }
    if (rules?.accompaniedByAdult === 'REQUIRED') r.admissionNotes.push('Детям нужен сопровождающий взрослый.');
  }
  return r;
}
export function partyPrice(r: PartyAssessment) {
  return r.total !== null ? `${r.total} ₽ за всех` : `Итого неизвестно. Известная часть: ${r.knownSubtotal} ₽${r.lowerBound > r.knownSubtotal ? `; не менее ${r.lowerBound} ₽ за всех` : ''}. ${r.unresolved.join(' ')}`;
}
