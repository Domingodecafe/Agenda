import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../fin-core.js', import.meta.url), 'utf8');
const ctx = vm.createContext({ Intl, Date });
vm.runInContext(source, ctx);
const core = ctx.FinCore;
const now = new Date('2026-10-29T15:00:00Z');
const item = (id, overrides = {}) => ({ id, clientId: 'fake-client', kind: 'appointment', type: 'Sessão', date: '2026-10-20', end: '11:00', value: 200, financialStatus: 'A receber', ...overrides });
const state = appointments => ({ clients: [], appointments });
const project = appointments => core.project(state(appointments), now);
const report = appointments => core.report(project(appointments), [], '2026-10', now);

test('Fin soma em centavos, sem erro decimal ou valores inválidos silenciosos', () => {
  assert.equal(core.cents('0.29'), 29);
  assert.equal(core.cents(200.1), 20010);
  for (const value of [-1, NaN, Infinity, '', null, '1,50', '1.001', '9007199254740992']) assert.throws(() => core.cents(value));
  assert.equal(report([item('a', { value: 0.1 }), item('b', { value: 0.2 })]).dueCents, 30);
});
test('Recebidos seguem data do pagamento e incluem antecipações', () => {
  const r = report([
    item('a', { date: '2026-11-20', financialStatus: 'Pago', payment: { date: '2026-10-28' } }),
    item('b', { financialStatus: 'Pago', payment: { date: '2026-09-28' } }),
    item('c', { financialStatus: 'Pago' }),
    item('d', { financialStatus: 'Pago', payment: { date: '2026-02-30' } }),
    item('e', { financialStatus: 'Pago', payment: { date: '2026-10-30' } })
  ]);
  assert.equal(r.receivedCents, 20000);
  assert.equal(r.undatedCents, 60000);
  assert.equal(r.warnings.length, 3);
});
test('Pendências abrangem todos os meses; próximas se limitam ao mês escolhido', () => {
  const r = report([item('a', { date: '2026-09-01' }), item('b', { financialStatus: 'Não pago' }),
    item('c', { date: '2026-10-30' }), item('d', { date: '2026-11-01' })]);
  assert.equal(r.dueCents, 40000); assert.equal(r.upcomingCents, 20000);
});
test('Bloqueios, tipo Outro e cancelados não pagos não geram previsões', () => {
  const r = report([item('a', { kind: 'block' }), item('b', { type: 'Outro' }),
    item('c', { status: 'Cancelado' }), item('d', { status: 'Cancelado', financialStatus: 'Pago', payment: { date: '2026-10-28' } })]);
  assert.equal(r.dueCents, 0); assert.equal(r.receivedCents, 20000);
  assert.equal(r.warnings[0].code, 'cancelled_unpaid_review');
});
test('Dados pessoais e histórico não saem na projeção; fonte permanece intacta', () => {
  const s = state([item('a', { clientName: 'NOME FICTICIO PRIVADO', notes: 'NOTA PRIVADA', phone: 'TELEFONE', paymentHistory: [{ secret: true }], payment: { methodDetail: 'TEXTO PRIVADO' } })]);
  s.clients.push({ name: 'NOME CADASTRO', notes: 'PRIVADO' });
  const before = JSON.stringify(s), projected = JSON.stringify(core.project(s, now));
  assert.doesNotMatch(projected, /PRIVAD|TELEFONE|NOME|secret/);
  assert.equal(JSON.stringify(s), before);
});
test('IDs ausentes ou duplicados interrompem o snapshot, sem duplicar totais', () => {
  assert.throws(() => project([item('a'), item('a')]));
  assert.throws(() => project([item('')]));
  assert.throws(() => core.project({}, now));
});
test('Datas, horas, valores e status inválidos produzem alertas verificáveis', () => {
  const p = project([item('a', { value: -1 }), item('b', { end: '25:00' }), item('c', { financialStatus: 'Parcial' }), item('d', { date: '2026-02-30' })]);
  assert.equal(p.records.length, 0); assert.equal(p.warnings.length, 4);
});
test('Calendário usa São Paulo inclusive no limite de mês UTC', () => {
  const clock = new Date('2026-11-01T01:00:00Z');
  assert.equal(core.dateParts(clock).date, '2026-10-31');
  const p = core.project(state([item('a', { date: '2026-10-31', end: '23:00' })]), clock);
  const r = core.report(p, [], '2026-10', clock);
  assert.equal(r.upcomingCents, 20000); assert.equal(r.dueCents, 0);
});
test('A sessão se torna pendência logo após o horário final', () => {
  const s = state([item('a', { date: '2026-10-29', end: '12:00' })]);
  assert.equal(core.report(core.project(s, now), [], '2026-10', now).dueCents, 0);
  const after = new Date('2026-10-29T15:00:01Z');
  assert.equal(core.report(core.project(s, after), [], '2026-10', after).dueCents, 20000);
});
test('Despesas pagas, estornos e saldo não misturam meses', () => {
  const entries = [
    { ...core.expense({ date: '2026-10-10', description: 'Aluguel fictício', value: '50.25' }, '2026-10-29') },
    { date: '2026-10-10', amountCents: 1000, voidedAt: now.toISOString() },
    { date: '2026-09-10', amountCents: 1000 }
  ];
  const r = core.report(project([item('a', { financialStatus: 'Pago', payment: { date: '2026-10-29' } })]), entries, '2026-10', now);
  assert.equal(r.expenseCents, 5025); assert.equal(r.netCashCents, 14975);
  for (const change of [{ date: '2026-10-30' }, { value: 0 }, { description: ' ' }]) assert.throws(() => core.expense({ date: '2026-10-10', description: 'Teste', value: 10, ...change }, '2026-10-29'));
});
test('Reler substitui o snapshot após correção ou exclusão, sem acumular recebidos', () => {
  assert.equal(report([item('a', { financialStatus: 'Pago', payment: { date: '2026-10-29' } })]).receivedCents, 20000);
  assert.equal(report([item('a')]).receivedCents, 0);
  assert.equal(report([]).dueCents, 0);
});
test('FinStore bloqueia acesso fora do ambiente da Ana', async () => {
  const storeSource = await readFile(new URL('../fin-store.js', import.meta.url), 'utf8');
  const context = vm.createContext({ AnaEnvironment: { isAllowed: () => false } });
  Object.defineProperty(context, 'indexedDB', { get() { assert.fail('Acesso fora do ambiente'); } });
  vm.runInContext(storeSource, context); assert.equal(context.FinStore, undefined);
});
test('Servidor e cache incluem todos os arquivos do Fin; Agenda abre o painel', async () => {
  const read = name => readFile(new URL('../' + name, import.meta.url), 'utf8');
  const preview = await read('preview.mjs'), worker = await read('sw-ana-dev.js');
  for (const file of ['fin-core.js', 'fin-ledger.js', 'fin-assistant.js', 'fin-store.js', 'fin-console.js', 'fin-console.html', 'fin-console.css']) {
    assert.ok(preview.includes(file)); assert.ok(worker.includes(file));
  }
  assert.match(await read('index.html'), /href="fin-console.html"/);
});
