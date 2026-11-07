const normalize = value => value.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase().replace(/\s+/g, ' ');
const weekdays = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const months = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const dateLabel = value => value.split('-').reverse().join('/');
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const validTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const present = value => value != null;

export function directRemoval(message, today) {
  const text = normalize(message).replace(/[.!]+$/, '').replace(/^sim[ ,]+/, '');
  if (/^(?:apague|exclua|remova) tod[oa]s? (?:os atendimentos|as sessoes|os agendamentos)$/.test(text)) {
    return { all: true };
  }
  const match = text.match(/^(?:apague|exclua|remova) (?:tudo|tod[oa]s? (?:os atendimentos|as sessoes|os agendamentos)) d(?:as|os) (domingo|segunda|terca|quarta|quinta|sexta|sabado)s?(?:[ -]feiras?)? ate (?:o )?fi(?:m|nal) do ano$/);
  if (match) return { from: today, through: today.slice(0, 4) + '-12-31', weekdays: [weekdays.findIndex(day => normalize(day) === match[1])] };
  const monthly = text.match(/^(?:apague|exclua|remova) os atendimentos (nao pagos|pagos) de ([a-z]+)(?: de (\d{4}))?$/);
  if (monthly && months.includes(monthly[2])) {
    const month = months.indexOf(monthly[2]) + 1;
    const year = monthly[3] || today.slice(0, 4);
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const through = new Date(Date.UTC(Number(year), month, 0)).toISOString().slice(0, 10);
    if (validRemovalFilters({ from, through })) return { from, through, payment: monthly[1] === 'pagos' ? 'paid' : 'unpaid' };
  }
  const weekly = text.match(/^(?:apague|exclua|remova) (?:os atendimentos|as sessoes) d[ao] ([\p{L} ]{1,100}) nesta semana$/u);
  if (weekly) {
    const names = weekly[1].split(/ e d[ao] /);
    const date = new Date(today + 'T00:00:00Z');
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    const from = date.toISOString().slice(0, 10);
    date.setUTCDate(date.getUTCDate() + 6);
    return { names, from, through: date.toISOString().slice(0, 10) };
  }
  return null;
}

export function validRemovalFilters(filters) {
  const { names, from, through, weekdays: days, start, throughTime, recurrence, payment } = filters;
  const hasDates = present(from) || present(through);
  if (hasDates && (!validDate(from) || !validDate(through) || from > through)) return false;
  if (present(names) && (!Array.isArray(names) || names.length < 1 || names.length > 20 ||
      !names.every(name => typeof name === 'string' && name.trim() && name.length <= 100))) return false;
  if (present(days) && (!Array.isArray(days) || days.length < 1 || days.length > 7 ||
      !days.every(day => Number.isInteger(day) && day >= 0 && day <= 6))) return false;
  if ((present(start) && !validTime(start)) || (present(throughTime) && !validTime(throughTime)) ||
      (start && throughTime && start > throughTime)) return false;
  if (present(recurrence) && !['series', 'single', 'weekly', 'biweekly', 'monthly'].includes(recurrence)) return false;
  if (present(payment) && !['paid', 'unpaid', 'not_paid'].includes(payment)) return false;
  return Boolean(hasDates || names || days || start || throughTime || recurrence || payment);
}

const hasPayment = item => item.financialStatus === 'Pago' || Boolean(item.payment);
const isRecurring = item => Boolean(item.seriesId && item.recurrence && item.recurrence !== 'none');

export function prepareBulkRemoval(state, filters, restrictedIds) {
  const { names, from, through, weekdays: days, start, throughTime, recurrence, payment } = filters;
  const appointments = state.appointments.filter(item => item.kind === 'appointment' && (!restrictedIds || restrictedIds.has(item.id)));
  const clients = new Map(state.clients.map(client => [client.id, client.name]));
  const nameOf = item => clients.get(item.clientId) || item.clientName || 'Atendimento';
  const nameByIdentity = new Map(appointments.map(item => [item.clientId || normalize(nameOf(item)), nameOf(item)]));
  const identities = new Set();
  for (const name of names || []) {
    const key = normalize(name);
    const entries = [...nameByIdentity];
    const exact = entries.filter(([, label]) => normalize(label) === key);
    const matches = exact.length ? exact : entries.filter(([, label]) => normalize(label).startsWith(key + ' '));
    if (!matches.length) return { reply: `Não encontrei atendimentos de ${name}. Qual é o nome cadastrado?` };
    if (matches.length > 1) return { reply: `Qual cliente você quer dizer?`, details: matches.map(([, label]) => label).join(' · ') };
    identities.add(matches[0][0]);
  }
  const selected = appointments.filter(item => {
    if (identities.size && !identities.has(item.clientId || normalize(nameOf(item)))) return false;
    if (from && (item.date < from || item.date > through)) return false;
    if (days && !days.includes(new Date(item.date + 'T00:00:00Z').getUTCDay())) return false;
    if (start && (throughTime ? item.start < start : item.start !== start)) return false;
    if (throughTime && item.start > throughTime) return false;
    if (payment === 'paid' && !hasPayment(item)) return false;
    if (payment === 'unpaid' && hasPayment(item)) return false;
    if (payment === 'not_paid' && item.financialStatus !== 'Não pago') return false;
    if (recurrence === 'single') return !isRecurring(item);
    if (recurrence === 'series') return isRecurring(item);
    return !recurrence || (isRecurring(item) && item.recurrence === recurrence);
  }).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  if (!selected.length) return { reply: 'Nenhum atendimento corresponde a esses filtros.' };
  const scope = [
    from && `${dateLabel(from)} a ${dateLabel(through)}`,
    days && [...new Set(days)].map(day => weekdays[day]).join(', '),
    identities.size && [...identities].map(id => nameByIdentity.get(id)).join(', '),
    start && (throughTime ? `${start} a ${throughTime}` : start),
    !start && throughTime && `até ${throughTime}`,
    recurrence && { series: 'recorrentes', single: 'avulsos', weekly: 'série semanal', biweekly: 'série quinzenal', monthly: 'série mensal' }[recurrence],
    payment && { paid: 'pagamento registrado', unpaid: 'sem pagamento registrado', not_paid: 'marcados como Não pago' }[payment],
  ].filter(Boolean).join(' · ') || 'Todos os atendimentos';
  return {
    removal: selected.map(item => item.id),
    reply: 'Revise o lote e toque em Confirmar exclusão.',
    review: {
      scope,
      paid: selected.filter(hasPayment).length,
      items: selected.map(item => `${dateLabel(item.date)} às ${item.start} · ${nameOf(item)}${hasPayment(item) ? ' · pagamento registrado' : ''}`),
    },
  };
}
