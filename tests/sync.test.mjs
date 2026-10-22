import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const ctx = vm.createContext({ structuredClone });
vm.runInContext(await readFile(new URL('../ana-sync-engine.js', import.meta.url), 'utf8'), ctx);
const { Engine, equal } = ctx.AnaSync;
const empty = () => ({ clients: [], appointments: [], settings: { view: 'week' } });
const copy = value => structuredClone(value);
const fixture = () => ({ clients: [{ id:'test-client',name:'TESTE FICTÍCIO',phone:'',defaultValue:0 }], appointments: [], settings:{view:'week'} });
function harness(initial = fixture(), options = {}) {
  const server = { revision: 1, payload: copy(initial) };
  const logs = [], saves = [], archives = [], writes = [];
  let online = true;
  const engine = new Engine({ data: initial, meta: options.meta,
    online: () => online,
    status: (...entry) => logs.push(entry),
    persist: async (data, meta) => saves.push({ data:copy(data),meta:copy(meta) }),
    archive: async (data,meta) => archives.push({data:copy(data),meta:copy(meta)}),
    read: async () => copy(server),
    write: async (owner, expected, data) => {
      if (expected !== server.revision) throw new Error('CONFLITO_REVISAO');
      writes.push({owner,expected,data:copy(data)}); server.revision += 1; server.payload = copy(data); return server.revision;
    }, ...options
  });
  async function activate(source = 'local') { await engine.authenticate('test-owner'); await engine.prepare(); await engine.choose(source); }
  return { engine, server, logs, saves, archives, writes, activate, offline: () => { online = false; }, online: () => { online = true; } };
}
test('Dados diferentes exigem decisão; login e consulta nunca substituem as fontes', async () => {
  const h = harness(empty()); h.server.payload = fixture();
  await h.engine.authenticate('test-owner');
  const decision = await h.engine.prepare();
  assert.equal(decision.different, true); assert.equal(h.engine.enabled, false);
  assert.equal(h.engine.data.clients.length, 0); assert.equal(h.writes.length, 0);
  await h.engine.choose('remote');
  assert.equal(h.engine.data.clients.length, 1); assert.equal(h.archives.length, 1);
  assert.equal(h.engine.currentStatus, 'Sincronizado');
});
test('Sem login ou ativação explícita, alterações só ficam locais', async () => {
  const h = harness(); const data = fixture(); data.clients[0].name += ' NOVO';
  await h.engine.localChanged(data); await h.engine.sync();
  assert.equal(h.writes.length, 0); assert.equal(h.saves.at(-1).meta.dirty, true);
  await assert.rejects(h.engine.prepare(), /login/);
});
test('Criação de paciente/sessão, horário, cancelamento e série recorrente incrementam revisões', async () => {
  const h = harness(); await h.activate(); let data = fixture();
  const changes = [
    () => data.clients.push({id:'test-2',name:'TESTE 002',phone:'',defaultValue:0}),
    () => data.appointments.push({id:'session-1',clientId:'test-2',date:'2026-10-23',start:'14:00',end:'15:00',value:0}),
    () => { data.appointments[0].start='15:00'; data.appointments[0].end='16:00'; },
    () => { data.appointments=[]; },
    () => { data.appointments=[0,1,2].map(i=>({id:'rec-'+i,seriesId:'series-test',start:'14:00',end:'15:00',value:0})); },
    () => { data.appointments.forEach(item=>{item.start='16:00';item.end='17:00';}); }
  ];
  for (const change of changes) {
    change(); await h.engine.localChanged(data);
    assert.notEqual(h.engine.currentStatus,'Sincronizado');
    await h.engine.sync(); assert.equal(h.engine.currentStatus,'Sincronizado');
    assert.ok(equal(h.server.payload,data));
  }
  assert.equal(h.server.revision,7);
});
test('Alteração durante envio não recebe confirmação da versão antiga', async () => {
  let release, started;
  const writing = new Promise(resolve=>{started=resolve;});
  const gate = new Promise(resolve=>{release=resolve;});
  const h = harness(); await h.activate();
  const originalWrite = h.engine.options.write;
  h.engine.options.write = async (...args)=>{started();await gate;return originalWrite(...args);};
  let data=fixture(); data.clients[0].name='TESTE A'; await h.engine.localChanged(data);
  const sending=h.engine.sync(); await writing;
  data.clients[0].name='TESTE B'; await h.engine.localChanged(data); release(); await sending;
  assert.equal(h.server.payload.clients[0].name,'TESTE A');
  assert.equal(h.engine.meta.dirty,true); assert.equal(h.engine.currentStatus,'Alterações pendentes');
  await h.engine.sync(); assert.equal(h.server.payload.clients[0].name,'TESTE B'); assert.equal(h.server.revision,3);
});
test('Revisão alterada por outra instância suspende a gravação e preserva ambos os estados', async () => {
  const h=harness();await h.activate();
  const data=fixture();data.clients[0].name='TESTE LOCAL';await h.engine.localChanged(data);
  h.server.revision=2;h.server.payload.clients[0].name='TESTE REMOTO';
  await h.engine.sync(); assert.equal(h.engine.currentStatus,'Conflito');assert.equal(h.engine.paused,true);
  assert.equal(h.writes.length,0);assert.equal(h.engine.data.clients[0].name,'TESTE LOCAL');
  assert.equal(h.server.payload.clients[0].name,'TESTE REMOTO');
});
test('Corrida entre SELECT e RPC é rejeitada pelo CAS no servidor', async () => {
  const h=harness();await h.activate();const write=h.engine.options.write;
  h.engine.options.write=async(...args)=>{h.server.revision++;return write(...args);};
  const data=fixture();data.clients.push({id:'conflict',name:'TESTE'});await h.engine.localChanged(data);await h.engine.sync();
  assert.equal(h.engine.currentStatus,'Conflito');assert.equal(h.engine.meta.dirty,true);assert.equal(h.writes.length,0);
});
test('Offline preserva pendências e verifica a revisão antes de retomar', async () => {
  const h=harness();await h.activate();h.offline();
  const data=fixture();data.clients[0].name='TESTE OFFLINE';await h.engine.localChanged(data);await h.engine.sync();
  assert.equal(h.engine.currentStatus,'Offline');assert.equal(h.writes.length,0);assert.equal(h.saves.at(-1).meta.dirty,true);
  h.server.revision++;h.online();await h.engine.sync();assert.equal(h.engine.currentStatus,'Conflito');assert.equal(h.writes.length,0);
});
test('Offline sem concorrência retoma e confirma o conteúdo correto', async () => {
  const h=harness();await h.activate();h.offline();const data=fixture();data.clients=[];
  await h.engine.localChanged(data);await h.engine.sync();h.online();await h.engine.sync();
  assert.equal(h.server.revision,2);assert.ok(equal(h.server.payload,data));
});
test('Erro 503 preserva o journal e permite nova tentativa controlada', async () => {
  const h=harness();await h.activate();const write=h.engine.options.write;
  h.engine.options.write=async()=>{throw new Error('503 serviço indisponível');};
  const data=fixture();data.clients[0].name='TESTE ERRO';await h.engine.localChanged(data);await h.engine.sync();
  assert.equal(h.engine.currentStatus,'Erro');assert.ok(equal(h.saves.at(-1).data,data));assert.equal(h.engine.meta.dirty,true);
  h.engine.options.write=write;await h.engine.sync();assert.equal(h.server.revision,2);
});
test('Resposta perdida após commit não duplica a revisão nem perde edição posterior', async () => {
  const h=harness();await h.activate();const write=h.engine.options.write;
  h.engine.options.write=async(...args)=>{await write(...args);throw new Error('Resposta perdida');};
  const data=fixture();data.clients[0].name='TESTE RESPOSTA';await h.engine.localChanged(data);await h.engine.sync();
  assert.equal(h.server.revision,2);assert.equal(h.engine.currentStatus,'Erro');
  h.engine.options.write=write;await h.engine.sync();
  assert.equal(h.server.revision,2);assert.equal(h.engine.currentStatus,'Sincronizado');assert.equal(h.engine.meta.dirty,false);
});
test('Reabertura preserva revisão e pendências, exigindo nova ativação', async () => {
  const h=harness();await h.activate();const data=fixture();data.clients[0].name='TESTE REABERTURA';await h.engine.localChanged(data);
  const saved=h.saves.at(-1);const reopened=harness(saved.data,{meta:saved.meta});
  assert.equal(reopened.engine.enabled,false);assert.equal(reopened.engine.meta.revision,1);assert.equal(reopened.engine.meta.dirty,true);
  await reopened.engine.sync();assert.equal(reopened.writes.length,0);
});
test('Fonte local alterada durante a decisão exige consultar novamente', async () => {
  const h=harness();await h.engine.authenticate('test-owner');await h.engine.prepare();
  const data=fixture();data.clients=[];await h.engine.localChanged(data);
  await assert.rejects(h.engine.choose('remote'),/Verifique/);assert.equal(h.engine.data.clients.length,0);
});
test('Fonte remota alterada durante decisão não é sobrescrita', async () => {
  const h=harness();await h.engine.authenticate('test-owner');await h.engine.prepare();h.server.revision++;
  assert.equal(await h.engine.choose('local'),false);assert.equal(h.engine.currentStatus,'Conflito');assert.equal(h.writes.length,0);
});
test('Desativar durante consulta impede iniciar transmissão', async () => {
  const h=harness();await h.activate();const data=fixture();data.clients=[];await h.engine.localChanged(data);
  let release, started;const gate=new Promise(resolve=>{release=resolve;});const waiting=new Promise(resolve=>{started=resolve;});
  const read=h.engine.options.read;h.engine.options.read=async()=>{started();await gate;return read();};
  const sending=h.engine.sync();await waiting;h.engine.disable();release();await sending;assert.equal(h.writes.length,0);
});
test('Falha de persistência bloqueia transmissão; dados permanecem em memória', async () => {
  const h=harness();await h.activate();h.engine.options.persist=async()=>{throw new Error('QuotaExceeded');};
  const data=fixture();data.clients=[];await assert.rejects(h.engine.localChanged(data),/QuotaExceeded/);
  await h.engine.sync();assert.equal(h.writes.length,0);assert.equal(h.engine.paused,true);assert.equal(h.engine.data.clients.length,0);
});
test('Outra conta não recebe automaticamente dados vinculados ao proprietário anterior', async () => {
  const h=harness();await h.activate();await assert.rejects(h.engine.authenticate('other-owner'),/outra conta/);assert.equal(h.engine.enabled,false);
});
test('Chamadas concorrentes de sincronização são serializadas', async () => {
  const h=harness();await h.activate();const data=fixture();data.clients=[];await h.engine.localChanged(data);
  await Promise.all([h.engine.sync(),h.engine.sync(),h.engine.sync()]);assert.equal(h.writes.length,1);assert.equal(h.server.revision,2);
});
