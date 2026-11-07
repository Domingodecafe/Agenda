import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgendaConflict, createSharedAgenda } from '../shared-agenda.mjs';

const now = () => new Date('2026-11-07T15:00:00Z');
const request = {
  name: 'Tobias Teste', date: '2026-11-13', start: '15:00', modality: 'Presencial', frequency: 'weekly',
};

function harness() {
  let snapshot;
  const store = {
    async read() { return structuredClone(snapshot); },
    async write(revision, payload) {
      if (revision !== (snapshot?.revision || 0)) throw new AgendaConflict();
      snapshot = { revision: revision + 1, payload: structuredClone(payload) };
      return snapshot.revision;
    },
  };
  return createSharedAgenda(store, { now });
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
  await agenda.book({ ...request, frequency: 'none', name: 'Alteração concorrente' });
  assert.match((await agenda.confirmRemoval(deletion.confirmation)).reply, /Agenda mudou/);
  const revised = await agenda.change({ ...changed, action: 'delete' });
  assert.match((await agenda.confirmRemoval(revised.confirmation)).reply, /1 atendimento apagado/);
  assert.match((await agenda.confirmRemoval(revised.confirmation)).reply, /expirou/);
  assert.ok(!(await agenda.read()).state.appointments.some(entry => entry.id === item.id));
});
