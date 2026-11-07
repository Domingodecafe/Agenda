/* Livro local do Fin. Regras puras; não acessa a Agenda nem serviços externos. */
(() => {
  'use strict';
  const categories = ['Espaço de atendimento', 'Ferramentas e assinaturas', 'Materiais', 'Divulgação', 'Formação', 'Tributos e taxas', 'Outros'];
  const clone = value => structuredClone(value);
  const fail = message => { throw new Error(message); };
  const text = (s, max = 160) => typeof s === 'string' && s.trim() && s.length <= max ? s.trim() : fail('Texto vazio ou fora do limite.');
  const id = s => text(s);
  const stamp = s => typeof s === 'string' && Number.isFinite(Date.parse(s)) ? s : fail('Registro sem instante válido.');
  const amount = n => Number.isSafeInteger(n) && n > 0 ? n : fail('Valor monetário inválido.');
  const month = s => /^\d{4}-(0[1-9]|1[0-2])$/.test(s || '') ? s : fail('Mês inválido.');
  const date = s => FinCore.validDate(s) ? s : fail('Data inválida.');
  function empty(now = new Date()) {
    return { version: 2, revision: 0, expenses: [], obligations: [], settings: { categories: [...categories], selectedMonth: FinCore.dateParts(now).date.slice(0, 7) } };
  }
  function unique(items, label) {
    if (new Set(items).size !== items.length) fail(`${label}: identificadores repetidos.`);
  }
  function occurrenceFor(o, targetMonth) {
    month(targetMonth);
    if (targetMonth < o.startDate.slice(0, 7) || (o.recurrence === 'once' && targetMonth !== o.startDate.slice(0, 7))) return null;
    const [y, m] = targetMonth.split('-').map(Number);
    const day = Math.min(Number(o.startDate.slice(8)), new Date(Date.UTC(y, m, 0)).getUTCDate());
    const dueDate = `${targetMonth}-${String(day).padStart(2, '0')}`;
    return { id: `${o.id}@${dueDate}`, obligationId: o.id, description: o.description, category: o.category, amountCents: o.amountCents, dueDate,
      cancelled: o.cancelled.some(c => c.date === dueDate), recurrence: o.recurrence };
  }
  function normalize(raw, now = new Date()) {
    const today = FinCore.dateParts(now).date;
    if (!raw || raw.version !== 2 || !Number.isSafeInteger(raw.revision) || raw.revision < 0) fail('Versão do livro inválida.');
    if (!Array.isArray(raw.expenses) || !Array.isArray(raw.obligations) || raw.expenses.length + raw.obligations.length > 50000) fail('Livro inválido ou muito grande.');
    const cats = raw.settings?.categories;
    if (!Array.isArray(cats) || !cats.length || cats.length > 50) fail('Informe entre 1 e 50 categorias.');
    const settings = { categories: cats.map(c => text(c, 80)), selectedMonth: month(raw.settings.selectedMonth) };
    unique(settings.categories, 'Categorias');
    const category = c => { c = c || 'Outros'; if (!settings.categories.includes(c)) fail(`Categoria em uso ausente da lista: ${c}`); return c; };
    const expenses = raw.expenses.map(e => {
      const r = { id: id(e.id), date: date(e.date), description: text(e.description), amountCents: amount(e.amountCents), category: category(e.category), createdAt: stamp(e.createdAt), actor: text(e.actor || 'owner-local', 80) };
      if (r.date > today) fail('Despesa paga com data futura.');
      if (e.voidedAt) r.voidedAt = stamp(e.voidedAt);
      if (e.occurrenceId) r.occurrenceId = text(e.occurrenceId, 180);
      return r;
    });
    const obligations = raw.obligations.map(o => {
      if (!['once', 'monthly'].includes(o.recurrence) || !Array.isArray(o.cancelled)) fail('Recorrência inválida.');
      const r = { id: id(o.id), description: text(o.description), amountCents: amount(o.amountCents), category: category(o.category), startDate: date(o.startDate), recurrence: o.recurrence, createdAt: stamp(o.createdAt), cancelled: o.cancelled.map(c => ({ date: date(c.date), changedAt: stamp(c.changedAt) })) };
      unique(r.cancelled.map(c => c.date), 'Cancelamentos');
      for (const c of r.cancelled) if (occurrenceFor(r, c.date.slice(0, 7))?.dueDate !== c.date) fail('Cancelamento sem ocorrência correspondente.');
      return r;
    });
    unique([...expenses, ...obligations].map(e => e.id), 'Livro');
    const paid = new Set();
    for (const e of expenses.filter(e => e.occurrenceId)) {
      const o = obligations.find(o => e.occurrenceId.startsWith(o.id + '@') && occurrenceFor(o, e.occurrenceId.slice(-10, -3))?.id === e.occurrenceId);
      if (!o || e.amountCents !== o.amountCents) fail('Pagamento sem conta correspondente ou com valor divergente.');
      const occ = occurrenceFor(o, e.occurrenceId.slice(-10, -3));
      if (!e.voidedAt) {
        if (paid.has(e.occurrenceId) || occ.cancelled) fail('Ocorrência paga duas vezes ou cancelada.');
        paid.add(e.occurrenceId);
      }
    }
    return { version: 2, revision: raw.revision, expenses, obligations, settings };
  }
  function occurrences(ledger, targetMonth) {
    return ledger.obligations.map(o => occurrenceFor(o, targetMonth)).filter(Boolean).map(o => {
      const payment = ledger.expenses.find(e => e.occurrenceId === o.id && !e.voidedAt);
      return { ...o, paymentId: payment?.id || null, status: o.cancelled ? 'cancelled' : payment ? 'paid' : 'open' };
    }).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
  }
  function apply(raw, cmd, now = new Date()) {
    const before = normalize(raw, now), s = clone(before), at = now.toISOString();
    let result;
    const findOccurrence = ref => {
      const found = occurrences(s, ref.slice(-10, -3)).find(o => o.id === ref);
      if (!found) fail('Ocorrência não encontrada.');
      return found;
    };
    if (cmd.type === 'expense.add' || cmd.type === 'obligation.add') {
      const requestId = id(cmd.requestId), input = cmd.input;
      const parsed = cmd.type === 'expense.add' ? FinCore.expense(input, FinCore.dateParts(now).date) : { date: date(input.date), description: text(input.description), amountCents: amount(FinCore.cents(input.value)) };
      const cat = input.category || 'Outros';
      const entry = { id: requestId, description: parsed.description, amountCents: parsed.amountCents, category: cat, createdAt: at };
      if (cmd.type === 'expense.add') { entry.date = parsed.date; entry.actor = 'owner-local'; }
      else { entry.startDate = parsed.date; entry.recurrence = input.recurrence || 'once'; entry.cancelled = []; }
      const list = cmd.type === 'expense.add' ? s.expenses : s.obligations;
      const existing = [...s.expenses, ...s.obligations].find(e => e.id === requestId);
      if (existing) {
        if (!list.includes(existing) || Object.keys(entry).some(k => !['createdAt', 'cancelled'].includes(k) && entry[k] !== existing[k])) fail('Identificador já usado com outros dados.');
        return { state: before, result: existing };
      }
      list.push(entry); result = entry;
    } else if (cmd.type === 'expense.void') {
      const e = s.expenses.find(e => e.id === cmd.id); if (!e) fail('Despesa não encontrada.');
      if (e.voidedAt) return { state: before, result: e };
      e.voidedAt = at; result = e;
    } else if (cmd.type === 'occurrence.pay') {
      const occ = findOccurrence(cmd.occurrenceId);
      const requestId = id(cmd.requestId), payDate = date(cmd.date);
      if (payDate > FinCore.dateParts(now).date) fail('Pagamento não pode ter data futura.');
      const previous = s.expenses.find(e => e.id === requestId);
      if (previous) {
        if (previous.occurrenceId !== occ.id || previous.date !== payDate) fail('Identificador de pagamento já utilizado.');
        return { state: before, result: previous };
      }
      if (occ.status !== 'open') fail('Esta ocorrência já foi paga ou cancelada.');
      result = { id: requestId, description: occ.description, amountCents: occ.amountCents, category: occ.category, date: payDate, occurrenceId: occ.id, createdAt: at, actor: 'owner-local' };
      s.expenses.push(result);
    } else if (cmd.type === 'occurrence.cancel') {
      const occ = findOccurrence(cmd.occurrenceId);
      if (occ.status === 'paid') fail('Estorne o pagamento antes de cancelar a ocorrência.');
      if (occ.cancelled) return { state: before, result: occ };
      s.obligations.find(o => o.id === occ.obligationId).cancelled.push({ date: occ.dueDate, changedAt: at }); result = occ;
    } else if (cmd.type === 'settings.save') {
      s.settings = { ...s.settings, ...clone(cmd.settings) }; result = s.settings;
    } else if (cmd.type === 'backup.restore') {
      if (cmd.expectedRevision !== before.revision) fail('O livro mudou após a prévia. Selecione o backup novamente.');
      const restored = validateBackup(cmd.backup, now);
      restored.revision = before.revision + 1;
      return { state: normalize(restored, now), result: { restored: true } };
    } else fail('Operação indisponível.');
    s.revision += 1;
    return { state: normalize(s, now), result };
  }
  function backup(ledger, now = new Date()) {
    return { schemaVersion: 'fin.backup.v2', currency: 'BRL', timezone: 'America/Sao_Paulo', createdAt: now.toISOString(), state: normalize(ledger, now) };
  }
  function validateBackup(data, now = new Date()) {
    if (!data || data.schemaVersion !== 'fin.backup.v2' || data.currency !== 'BRL' || data.timezone !== 'America/Sao_Paulo') fail('Este arquivo não é um backup restaurável do Fin v2.');
    stamp(data.createdAt); return normalize(data.state, now);
  }
  globalThis.FinLedger = Object.freeze({ empty, normalize, occurrences, apply, backup, validateBackup, month });
})();
