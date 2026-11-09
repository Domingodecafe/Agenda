import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAgentChat } from '../agent-chat-server.mjs';
import { AgendaConflict, createSharedAgenda } from '../shared-agenda.mjs';
import { directRemoval, prepareBulkRemoval, validRemovalFilters } from '../ana-bulk-removal.mjs';

const now = () => new Date('2026-11-07T15:00:00Z');
const request = {
  name: 'Tobias Teste', date: '2026-11-13', start: '15:00', modality: 'Presencial', frequency: 'weekly',
};

function harness(clock = now, exposeStore) {
  let snapshot;
  const store = {
    async read() { return structuredClone(snapshot); },
    async write(revision, payload) {
      if (revision !== (snapshot?.revision || 0)) throw new AgendaConflict();
      snapshot = { revision: revision + 1, payload: structuredClone(payload) };
      return snapshot.revision;
    },
  };
  exposeStore?.(store);
  return createSharedAgenda(store, { now: clock });
}

test('Ana agenda série semanal de 52 sessões atomicamente e reconhece repetição', async () => {
  const agenda = harness();
  await agenda.read();
  const seriesRequest = { ...request, date: '2026-12-04' };
  const booked = await agenda.book(seriesRequest);
  assert.match(booked.details, /52 sessões/);
  const { state, revision } = await agenda.read();
  const series = state.appointments.filter(item => item.clientName === request.name);
  assert.equal(series.length, 52);
  assert.equal(new Set(series.map(item => item.seriesId)).size, 1);
  assert.ok(series.every(item => item.start === '15:00' && item.end === '16:00' && item.value === 200));
  assert.match((await agenda.book(seriesRequest)).reply, /já está na Agenda/);
  assert.equal((await agenda.read()).revision, revision);
});

test('Conflito no meio da série não cria cliente nem agenda sessões parciais', async () => {
  const agenda = harness();
  await agenda.book({ ...request, frequency: 'none', date: '2026-11-20', name: 'Bloqueio Teste' });
  const previous = await agenda.read();
  const result = await agenda.book({ ...request, count: 3 });
  assert.match(result.details, /20\/11\/2026/);
  assert.deepEqual(await agenda.read(), previous);
});

test('Ana remarca uma sessão, preserva recebimento ao cancelar e exige revisão para apagar', async () => {
  const agenda = harness();
  const booked = await agenda.book({ ...request, frequency: 'none' });
  const select = { name: request.name, date: request.date, start: request.start, scope: 'single' };
  const moved = await agenda.change({ ...select, action: 'edit', newStart: '18:00', modality: 'Online' });
  assert.equal(moved.appointment.id, booked.appointment.id);
  const original = await agenda.read();
  const item = original.state.appointments.find(item => item.id === booked.appointment.id);
  assert.equal(item.start, '18:00');
  item.financialStatus = 'Pago';
  item.payment = { date: '2026-11-07', method: 'PIX' };
  await agenda.write(original.revision, original.state);
  const changed = { ...select, start: '18:00' };
  await agenda.change({ ...changed, action: 'cancel' });
  assert.ok((await agenda.consult('ana', request.date)).starts.includes('18:00'));
  assert.equal((await agenda.consult('fin', '2026-11')).receivedCents, 340000);
  const deletion = await agenda.change({ ...changed, action: 'delete' });
  assert.match(deletion.details, /1 com pagamento/);
  assert.ok((await agenda.read()).state.appointments.some(entry => entry.id === item.id));
  const edited = await agenda.read();
  edited.state.appointments.find(entry => entry.id === item.id).end = '19:10';
  await agenda.write(edited.revision, edited.state);
  assert.match((await agenda.confirmRemoval(deletion.confirmation)).reply, /Agenda mudou/);
  const revised = await agenda.change({ ...changed, action: 'delete' });
  assert.match((await agenda.confirmRemoval(revised.confirmation)).reply, /1 atendimento apagado/);
  assert.match((await agenda.confirmRemoval(revised.confirmation)).reply, /já foi processado/);
  assert.ok(!(await agenda.read()).state.appointments.some(entry => entry.id === item.id));
});

test('Pedidos claros em português viram filtros com datas concretas', () => {
  const today = '2026-11-07';
  const wednesdays = { from: today, through: '2026-12-31', weekdays: [3] };
  assert.deepEqual(directRemoval('Apague todos os atendimentos das quartas até o fim do ano', today), wednesdays);
  assert.deepEqual(directRemoval('Sim apague tudo das quarta feiras ate o final do ano', today), wednesdays);
  assert.deepEqual(directRemoval('Apague as sessões da Lia e do Caio nesta semana', today),
    { names: ['lia', 'caio'], from: '2026-11-02', through: '2026-11-08' });
  assert.deepEqual(directRemoval('Apague os atendimentos não pagos de novembro', today),
    { from: '2026-11-01', through: '2026-11-30', payment: 'unpaid' });
  assert.deepEqual(directRemoval('Apague todos os atendimentos', today), { all: true });
  assert.equal(directRemoval('Apague meu horário', today), null);
  assert.equal(validRemovalFilters({}), false);
  assert.equal(validRemovalFilters({ from: '2026-11-07', through: '2026-02-31' }), false);
});

test('Lote combina clientes, datas, dias, horários, recorrência e pagamento', () => {
  const item = { kind: 'appointment', clientId: 'lia', date: '2026-11-11', start: '14:00', recurrence: 'weekly', seriesId: 's' };
  const state = {
    clients: [{ id: 'lia', name: 'Lia Teste' }, { id: 'caio', name: 'Caio Teste' }],
    appointments: [
      { ...item, id: 'a', financialStatus: 'Pago' },
      { ...item, id: 'b', clientId: 'caio' },
      { ...item, id: 'c', date: '2027-01-06' },
      { ...item, id: 'd', start: '16:00' },
      { ...item, id: 'e', date: '2026-11-12' },
      { ...item, id: 'f', recurrence: 'none', seriesId: null },
      { ...item, id: 'g', kind: 'block' },
    ],
  };
  const filters = { names: ['Lia', 'Caio'], from: '2026-11-07', through: '2026-12-31',
    weekdays: [3], start: '14:00', throughTime: '15:00', recurrence: 'weekly' };
  const result = prepareBulkRemoval(state, filters);
  assert.deepEqual(result.removal, ['a', 'b']);
  assert.equal(result.review.paid, 1);
  assert.equal(result.review.items.length, 2);
  assert.deepEqual(prepareBulkRemoval(state, { ...filters, payment: 'unpaid' }).removal, ['b']);
  assert.match(prepareBulkRemoval(state, { ...filters, weekdays: [0] }).reply, /Nenhum/);
});

test('Sim aponta para o cartão, recorrência preserva o filtro e mudança exige nova revisão', async () => {
  const agenda = harness();
  const initial = await agenda.read();
  const base = { ...initial.state.appointments[0], clientId: 'teste-cliente-0', date: '2026-12-02', recurrence: 'weekly', seriesId: 'serie' };
  initial.state.appointments.push({ ...base, id: 'dentro' }, { ...base, id: 'fora', date: '2027-01-06' });
  await agenda.write(initial.revision, initial.state);
  const filters = directRemoval('Apague tudo das quartas até o fim do ano', '2026-11-07');
  const preview = await agenda.bulkRemoval(filters);
  const version = (await agenda.read()).revision;
  assert.equal((await agenda.continueRemoval(preview.confirmation, false)).showConfirmation, true);
  assert.equal((await agenda.read()).revision, version);
  const recurring = await agenda.continueRemoval(preview.confirmation, true);
  assert.equal(recurring.review.items.length, 1);
  assert.match(recurring.review.items[0], /02\/12\/2026/);
  assert.match((await agenda.confirmRemoval(preview.confirmation)).reply, /expirou/);
  const changed = await agenda.read();
  changed.state.appointments.find(item => item.id === 'dentro').end = '19:10';
  await agenda.write(changed.revision, changed.state);
  assert.match((await agenda.confirmRemoval(recurring.confirmation)).reply, /Agenda mudou/);
  const final = await agenda.bulkRemoval({ ...filters, recurrence: 'series' });
  await agenda.confirmRemoval(final.confirmation);
  const { state } = await agenda.read();
  assert.ok(state.appointments.some(item => item.id === 'fora'));
  assert.ok(!state.appointments.some(item => item.id === 'dentro'));
  assert.equal(state.appointments.length, 84);
});

test('Central compartilha avisos e aprovações entre instâncias e decide uma exclusão uma só vez', async () => {
  let store;
  const agenda = harness(now, value => { store = value; });
  const other = createSharedAgenda(store, { now });
  const filters = { from: '2026-11-02', through: '2026-11-02' };
  const preview = await agenda.bulkRemoval(filters, 'text');
  await other.addNotice('Revisar agenda', 'Conferir horários de sexta.', 'voice');
  const [notice, approval] = await agenda.listQueue();
  assert.equal(notice.source, 'voice');
  assert.equal(approval.id, preview.confirmation);
  assert.equal(approval.expiresAt - approval.createdAt, 86400000);
  const snapshot = await agenda.read();
  const { anaQueue, ...publicState } = snapshot.state;
  await agenda.write(snapshot.revision, { ...publicState, anaQueue: [] });
  assert.equal((await other.listQueue()).length, 2);
  const decisions = await Promise.all([agenda.confirmRemoval(approval.id), other.decide(approval.id, 'approve')]);
  assert.equal(decisions.filter(result => result.changed).length, 1);
  await other.decide(notice.id, 'resolve');
  assert.deepEqual((await agenda.listQueue()).map(item => item.status), ['resolved', 'approved']);
});

test('Recusar ou deixar expirar um pedido preserva os atendimentos', async () => {
  let time = now();
  const agenda = harness(() => time);
  const filters = { from: '2026-11-02', through: '2026-11-02' };
  const first = await agenda.bulkRemoval(filters);
  const second = await agenda.bulkRemoval(filters, 'voice');
  const before = (await agenda.read()).state.appointments;
  await agenda.decide(first.confirmation, 'reject');
  assert.match((await agenda.confirmRemoval(first.confirmation)).reply, /já foi processado/);
  time = new Date(time.getTime() + 86400000);
  assert.match((await agenda.confirmRemoval(second.confirmation)).reply, /expirou/);
  assert.deepEqual((await agenda.listQueue()).map(item => item.status), ['expired', 'rejected']);
  assert.deepEqual((await agenda.read()).state.appointments, before);
});

test('Ana registra aviso de voz após a ferramenta e mantém confirmação falada pendente', async () => {
  const agenda = harness();
  const chat = createAgentChat({
    origin: 'https://agenda.example',
    apiKey: 'test', model: 'test', agenda,
    fetchResponse: async () => Response.json({ status: 'completed', output: [{
      type: 'function_call', name: 'registrar_aviso', call_id: 'call_notice',
      arguments: JSON.stringify({ assunto: 'Horário de sexta', resumo: 'Conferir o horário de sexta.' }),
    }] }),
  });
  const turn = { agent: 'ana', history: [], voice: true };
  const result = await chat.processTurn({ ...turn, message: 'Deixa um aviso para eu revisar o horário de sexta.' });
  assert.match(result.reply, /Registrei o aviso/);
  const preview = await agenda.bulkRemoval({ from: '2026-11-02', through: '2026-11-02' });
  const reply = await chat.processTurn({ ...turn, message: 'confirmo', pendingRemoval: preview.confirmation });
  assert.equal(reply.showConfirmation, true);
  assert.deepEqual((await agenda.listQueue()).map(item => [item.kind, item.source, item.status]), [
    ['approval', 'text', 'pending'], ['notice', 'voice', 'pending'],
  ]);
});
