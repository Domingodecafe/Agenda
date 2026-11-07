/* Contrato financeiro puro: sem rede, DOM ou alteração da Agenda. */
(() => {
  'use strict';
  const VERSION = 'fin.agenda.v1';
  const zone = 'America/Sao_Paulo';
  function dateParts(now = new Date()) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(x => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
  }
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const d = new Date(value + 'T12:00:00Z');
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
  }
  function cents(value) {
    if (!['number', 'string'].includes(typeof value) || value === '' || !/^\d+(\.\d{1,2})?$/.test(String(value))) throw new Error('Valor inválido: use reais com até duas casas decimais.');
    const n = Math.round(Number(value) * 100);
    if (!Number.isSafeInteger(n) || n < 0) throw new Error('Valor fora do limite.');
    return n;
  }
  function project(state, now = new Date()) {
    if (!state || !Array.isArray(state.appointments) || !Array.isArray(state.clients)) throw new Error('Estado da Agenda inválido.');
    const today = dateParts(now).date;
    const records = [], warnings = [], ids = new Set();
    for (const a of state.appointments) {
      if (a.kind !== 'appointment' || a.type === 'Outro') continue;
      if (typeof a.id !== 'string' || !a.id || ids.has(a.id)) throw new Error('Sessão sem ID ou duplicada. Corrija a Agenda antes de integrar.');
      ids.add(a.id);
      const warn = code => warnings.push({ appointmentId: a.id, code });
      let amountCents;
      try { amountCents = cents(a.value); } catch { warn('invalid_amount'); continue; }
      if (!validDate(a.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(a.end || '')) { warn('invalid_session_date'); continue; }
      const status = a.financialStatus || 'A receber';
      if (!['Pago', 'A receber', 'Não pago'].includes(status)) { warn('unknown_financial_status'); continue; }
      const paid = status === 'Pago';
      const paymentDate = paid && validDate(a.payment?.date) && a.payment.date <= today ? a.payment.date : null;
      if (paid && !paymentDate) warn('paid_without_valid_date');
      const cancelled = a.cancelled === true || ['Cancelado', 'Cancelada', 'cancelled'].includes(a.status);
      if (cancelled && !paid) warn('cancelled_unpaid_review');
      // Apenas campos financeiros: observações, telefone, modalidade e anexos não saem.
      records.push({ appointmentId: a.id, clientRef: a.clientId || `session:${a.id}`, sessionDate: a.date,
        endTime: a.end, amountCents, status, paymentDate, paymentMethod: paid ? (a.payment?.method || null) : null,
        cancelled });
    }
    return { schemaVersion: VERSION, source: 'ana-dev-agenda', currency: 'BRL', timezone: zone,
      generatedAt: now.toISOString(), records, warnings };
  }
  function expense(input, today = dateParts().date) {
    if (!validDate(input.date) || input.date > today) throw new Error('Informe a data da despesa paga, até hoje.');
    const description = String(input.description || '').trim();
    if (!description || description.length > 160) throw new Error('Descreva a despesa em até 160 caracteres.');
    const amountCents = cents(input.value);
    if (!amountCents) throw new Error('A despesa precisa ser maior que zero.');
    return { date: input.date, description, amountCents };
  }
  function report(snapshot, expenses, month, now = new Date()) {
    if (snapshot.schemaVersion !== VERSION || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Contrato ou mês inválido.');
    const current = dateParts(now);
    const received = [], due = [], upcoming = [], undated = [];
    for (const r of snapshot.records) {
      if (r.status === 'Pago') {
        if (!r.paymentDate) undated.push(r);
        else if (r.paymentDate.startsWith(month)) received.push(r);
      } else if (!r.cancelled) {
        if (`${r.sessionDate}T${r.endTime}:00` < `${current.date}T${current.time}`) due.push(r);
        else if (r.sessionDate.startsWith(month)) upcoming.push(r);
      }
    }
    const sum = items => items.reduce((n, r) => {
      const total = n + r.amountCents;
      if (!Number.isSafeInteger(total)) throw new Error('Total fora do limite.');
      return total;
    }, 0);
    const monthlyExpenses = expenses.filter(e => !e.voidedAt && e.date.startsWith(month));
    const receivedCents = sum(received), expenseCents = sum(monthlyExpenses);
    return { month, receivedCents, expenseCents, netCashCents: receivedCents - expenseCents,
      dueCents: sum(due), upcomingCents: sum(upcoming), undatedCents: sum(undated),
      received, due, upcoming, undated, expenses: monthlyExpenses, warnings: snapshot.warnings };
  }
  function forecast(snapshot, ledger, month, now = new Date()) {
    const r = report(snapshot, ledger.expenses, month, now);
    const occurrences = FinLedger.occurrences(ledger, month);
    const open = occurrences.filter(o => o.status === 'open');
    const total = items => items.reduce((sum, i) => {
      const n = sum + i.amountCents;
      if (!Number.isSafeInteger(n)) throw new Error('Total fora do limite.');
      return n;
    }, 0);
    const historical = month < dateParts(now).date.slice(0, 7);
    const plannedExpenseCents = total(open);
    const grossCents = r.netCashCents + r.upcomingCents;
    if (!Number.isSafeInteger(grossCents)) throw new Error('Projeção fora do limite.');
    const projectedCents = grossCents - plannedExpenseCents;
    if (!Number.isSafeInteger(projectedCents)) throw new Error('Projeção fora do limite.');
    return { ...r, occurrences, openObligations: open, plannedExpenseCents, historical,
      projectedCents: historical ? null : projectedCents, sourceAt: snapshot.generatedAt };
  }
  function simulate(snapshot, ledger, month, count, now = new Date()) {
    const r = forecast(snapshot, ledger, month, now);
    if (r.historical) throw new Error('Simulação disponível apenas para o mês atual ou futuro.');
    if (!Number.isInteger(count) || count < 1 || count > r.upcoming.length) throw new Error('Informe uma quantidade entre 1 e o número de sessões futuras sem pagamento.');
    const sorted = [...r.upcoming].sort((a, b) => a.amountCents - b.amountCents || a.appointmentId.localeCompare(b.appointmentId));
    const cheapest = sorted.slice(0, count), highest = sorted.slice(-count);
    const sum = items => items.reduce((n, e) => n + e.amountCents, 0);
    const minCents = r.projectedCents - sum(highest), maxCents = r.projectedCents - sum(cheapest);
    if (![minCents, maxCents].every(Number.isSafeInteger)) throw new Error('Simulação fora do limite.');
    return { ...r, count, minCents, maxCents, cheapest, highest };
  }
  globalThis.FinCore = Object.freeze({ VERSION, dateParts, validDate, cents, project, expense, report, forecast, simulate });
})();
