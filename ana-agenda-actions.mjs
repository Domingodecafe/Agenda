import { randomUUID } from 'node:crypto';

const day = 86400000;
const dateLabel = date => date.split('-').reverse().join('/');
const label = item => `${dateLabel(item.date)} às ${item.start}`;
const active = item => !item.cancelled && !['Cancelado', 'Cancelada', 'cancelled'].includes(item.status);
const normalize = value => value.normalize('NFD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toLowerCase();
const shiftDays = (date, offset) => new Date(Date.parse(date + 'T00:00:00Z') + offset * day).toISOString().slice(0, 10);

function occurrence(date, frequency, index) {
  if (frequency !== 'monthly') return shiftDays(date, index * (frequency === 'biweekly' ? 14 : 7));
  const [year, month, number] = date.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + index, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(number, last));
  return target.toISOString().slice(0, 10);
}

export function prepareSeries(state, request, now) {
  const { frequency, count, until } = request;
  if (!frequency || frequency === 'none') return AgentChat.prepareBooking(state, request, now, randomUUID);
  const limit = count ?? (until ? 104 : { weekly: 52, biweekly: 26, monthly: 12 }[frequency]);
  const dates = Array.from({ length: limit }, (_, index) => occurrence(request.date, frequency, index))
    .filter(date => !until || date <= until);
  if (!dates.length || (until && occurrence(request.date, frequency, limit) <= until)) {
    return { reply: 'Confira a data final. Uma série pode ter até 104 sessões por pedido.' };
  }
  const key = normalize(request.name);
  const existing = state.appointments.filter(item => item.kind === 'appointment' && active(item) && item.seriesId &&
    item.recurrence === frequency && item.start === request.start && normalize(item.clientName || '') === key);
  const first = existing.find(item => item.date === dates[0]);
  if (first && dates.every(date => existing.some(item => item.seriesId === first.seriesId && item.date === date))) {
    return { reply: 'Essa série já está na Agenda.', appointment: { id: first.id } };
  }
  const seriesId = randomUUID();
  let draft = state;
  let firstId;
  const conflicts = [];
  for (const date of dates) {
    const entry = AgentChat.prepareBooking(draft, { ...request, date }, now, randomUUID);
    if (!entry.state) {
      if (entry.reply.includes('mais de um cliente')) return entry;
      conflicts.push(dateLabel(date));
      continue;
    }
    draft = entry.state;
    const appointment = draft.appointments.at(-1);
    Object.assign(appointment, { recurrence: frequency, seriesId });
    firstId ||= appointment.id;
  }
  if (conflicts.length) return { reply: 'A série não foi gravada. Há datas indisponíveis.',
    details: conflicts.join(', ') };
  return { state: draft, appointment: { id: firstId },
    reply: `Série agendada para ${draft.appointments.at(-1).clientName}.`,
    details: `${dates.length} sessões · de ${dateLabel(dates[0])} a ${dateLabel(dates.at(-1))} · ${request.start} · ${request.modality} · 60 min · R$ 200,00 por sessão` };
}

export function prepareChange(state, request, now) {
  const key = normalize(request.name);
  const candidates = state.appointments.filter(item => item.kind === 'appointment' &&
    (request.action === 'delete' || active(item)) &&
    (normalize(item.clientName || '') === key ||
      normalize(state.clients.find(client => client.id === item.clientId)?.name || '') === key));
  const matching = candidates.filter(item => (!request.date || item.date === request.date) && (!request.start || item.start === request.start));
  const series = new Set(matching.map(item => item.seriesId));
  const target = matching.length === 1 ? matching[0] :
    request.scope === 'series' && series.size === 1 && !series.has(null) && !series.has(undefined) ?
      matching.toSorted((a, b) => a.date.localeCompare(b.date))[0] : null;
  if (!target) return { reply: matching.length ?
    'Encontrei mais de um atendimento. Informe a data e o horário da sessão ou identifique a série.' :
    'Não encontrei um atendimento com esses dados. Confira o nome, a data e o horário.',
  ...(matching.length && { details: matching.slice(0, 8).map(label).join(' · ') }) };
  if (request.scope && request.scope !== 'single' && !target.seriesId) return { reply: 'Esse atendimento não faz parte de uma série.' };
  const selected = !request.scope || request.scope === 'single' ? [target] :
    candidates.filter(item => item.seriesId === target.seriesId && (request.scope === 'series' || item.date >= target.date));
  const ids = new Set(selected.map(item => item.id));
  const count = selected.length;
  const summary = `${target.clientName} · ${count} ${count === 1 ? 'sessão' : 'sessões'} · ${selected.map(label).join(' · ')}`;
  if (request.action === 'delete') return { removal: [...ids], reply: 'Confirme a exclusão dos atendimentos abaixo.',
    details: summary + ` · ${selected.filter(item => item.financialStatus === 'Pago' || item.payment).length} com pagamento registrado` };
  if (request.action === 'cancel') return {
    state: { ...state, appointments: state.appointments.map(item => ids.has(item.id) ? { ...item, cancelled: true, status: 'Cancelado' } : item) },
    reply: count === 1 ? 'Atendimento cancelado. O histórico foi preservado.' : `${count} atendimentos cancelados. O histórico foi preservado.`,
    details: summary,
  };
  if (!request.newDate && !request.newStart && !request.modality && request.value == null && request.duration == null) {
    return { reply: 'O que você quer alterar no atendimento?' };
  }
  if (request.value != null && selected.some(item => (item.financialStatus === 'Pago' || item.payment) && request.value !== item.value)) {
    return { reply: 'Há pagamento registrado. Para corrigir o valor recebido, revise o pagamento no Financeiro.' };
  }
  const offset = request.newDate ? (Date.parse(request.newDate) - Date.parse(target.date)) / day : 0;
  const changed = new Map();
  const other = state.appointments.filter(item => !ids.has(item.id) && active(item));
  const conflicts = [];
  for (const item of selected) {
    const date = shiftDays(item.date, offset);
    const start = request.newStart || item.start;
    const duration = request.duration ?? (AnaPolicy.stamp(item.date, item.end) - AnaPolicy.stamp(item.date, item.start)) / 60000;
    const end = AnaPolicy.timeAt(AnaPolicy.stamp(date, start) + duration * 60000);
    if (date !== item.date || start !== item.start || end !== item.end) {
      const appointments = [...other, ...changed.values()].filter(entry => entry.date === date);
      if (!AnaPolicy.slotAvailable({ appointments, blocks: [], reservations: [] }, date, start, now.getTime(), { duration })) {
        conflicts.push(label({ date, start }));
      }
    }
    changed.set(item.id, { ...item, date, start, end,
      modality: request.modality || item.modality, value: request.value ?? item.value });
  }
  if (conflicts.length) return { reply: 'Nenhum atendimento foi alterado. Há horários indisponíveis.', details: conflicts.join(' · ') };
  return { state: { ...state, appointments: state.appointments.map(item => changed.get(item.id) || item) },
    reply: count === 1 ? 'Atendimento atualizado.' : `${count} atendimentos atualizados.`,
    details: `${target.clientName} · ${[...changed.values()].map(label).join(' · ')}`, appointment: { id: target.id } };
}
