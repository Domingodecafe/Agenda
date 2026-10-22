// Execução explícita contra Secretaria Ana DEV. Credenciais chegam só por stdin.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
const ctx=vm.createContext({structuredClone});
vm.runInContext(await readFile(new URL('../ana-sync-engine.js',import.meta.url),'utf8'),ctx);
const {Engine,equal}=ctx.AnaSync;
const url='https://dpdxzbbzymkygutwefww.supabase.co';
if (process.stdin.isTTY) process.stdin.setRawMode(true); // Não ecoar credenciais no terminal.
const input=createInterface({input:process.stdin,terminal:false});
console.log('Aguardando configuração de teste por stdin (não será registrada).');
const secrets=JSON.parse(await input.question('')); input.close();
if (process.stdin.isTTY) process.stdin.setRawMode(false);
assert.match(secrets.key,/^sb_publishable_/);
const tokens=[];const report=[];
async function api(path,{token,body,method='GET'}={}) {
  const response=await fetch(url+path,{method,headers:{apikey:secrets.key,...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const text=await response.text();const data=text?JSON.parse(text):null;
  if(!response.ok){const error=new Error(data?.message||data?.msg||`HTTP ${response.status}`);error.code=data?.code;throw error;}
  return data;
}
async function login(){const data=await api('/auth/v1/token?grant_type=password',{method:'POST',body:{email:secrets.email,password:secrets.password}});tokens.push(data.access_token);return data;}
function driver(auth){return {
  read:async()=>{const rows=await api('/rest/v1/agenda_snapshots?select=revision,payload&owner_id=eq.'+auth.user.id,{token:auth.access_token});assert.ok(rows.length<=1);return rows[0]||null;},
  write:async(owner,revision,payload)=>{assert.equal(owner,auth.user.id);return api('/rest/v1/rpc/write_agenda_snapshot',{method:'POST',token:auth.access_token,body:{p_expected_revision:revision,p_payload:payload}});}
};}
function make(data,auth,driver,meta){let online=true;let saved;const engine=new Engine({data,meta,online:()=>online,...driver,persist:async(data,meta)=>{saved={data:structuredClone(data),meta:structuredClone(meta)};}});
return{engine,saved:()=>saved,online:value=>{online=value;},activate:async()=>{await engine.authenticate(auth.user.id);await engine.prepare();await engine.choose('remote');}};}
function fictional(payload){assert.ok(payload.clients.length>0);assert.ok(payload.clients.every(c=>/^TESTE/.test(c.name)&&!c.phone&&Number(c.defaultValue||0)===0));assert.ok(payload.appointments.every(a=>Number(a.value||0)===0));}
async function verify(label,engine,driver,extra={}){const remote=await driver.read();assert.ok(equal(remote.payload,engine.data));assert.equal(engine.currentStatus,'Sincronizado');fictional(remote.payload);report.push({label,revision:remote.revision,clients:remote.payload.clients.length,appointments:remote.payload.appointments.length,...extra});console.log('PASS',label,'revisão',remote.revision);return remote;}
try {
  const authA=await login(),authB=await login();assert.equal(authA.user.id,authB.user.id);
  const aDriver=driver(authA),bDriver=driver(authB);const initial=await aDriver.read();assert.ok(initial);fictional(initial.payload);
  assert.ok(initial.payload.clients.some(c=>c.id==='c1db2559-eb2b-469f-aa38-d5c683b3fae1'));
  await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});
  await writeFile(new URL('../test-results/antes-aula36-ficticio.json',import.meta.url),JSON.stringify(initial,null,2));
  let a=make(initial.payload,authA,aDriver);await a.activate();
  async function change(label,mutate,extra){const data=structuredClone(a.engine.data);mutate(data);await a.engine.localChanged(data);await a.engine.sync();return verify(label,a.engine,aDriver,extra);}
  const clientId=randomUUID();
  await change('Criação de paciente',data=>data.clients.push({id:clientId,name:'TESTE Aula 3.6 — FICTÍCIO',phone:'',defaultValue:0,notes:'DADO FICTÍCIO. Validação automática.',color:'blue'}));
  const sessionId=randomUUID();
  const appointment=(id,date)=>({id,kind:'appointment',clientId,clientName:'TESTE Aula 3.6 — FICTÍCIO',date,start:'14:00',end:'15:00',value:0,type:'Sessão',modality:'Presencial',color:'blue',status:'Agendado',financialStatus:'A receber',seriesId:null,recurrence:'none'});
  await change('Criação de atendimento',data=>data.appointments.push(appointment(sessionId,'2026-10-23')));
  await change('Alteração de horário',data=>{const item=data.appointments.find(a=>a.id===sessionId);item.start='15:00';item.end='16:00';});
  await change('Cancelamento sem cobrança',data=>{data.appointments=data.appointments.filter(a=>a.id!==sessionId);});
  const seriesId=randomUUID();
  await change('Criação de série recorrente',data=>{for(const date of ['2026-10-23','2026-10-30','2026-11-06'])data.appointments.push({...appointment(randomUUID(),date),seriesId,recurrence:'weekly'});});
  await change('Atualização de série recorrente',data=>{data.appointments.filter(a=>a.seriesId===seriesId&&a.date>='2026-10-30').forEach(a=>{a.start='16:00';a.end='17:00';});});
  const saved=a.saved();a=make(saved.data,authA,aDriver,saved.meta);assert.equal(a.engine.enabled,false);assert.ok(equal(a.engine.data,saved.data));await a.activate();
  await verify('Reabertura com consentimento renovado',a.engine,aDriver);
  const b=make({clients:[],appointments:[],settings:{view:'week'}},authB,bDriver);await b.activate();await verify('Recuperação por segunda sessão autenticada',b.engine,bDriver);
  a.online(false);const offline=structuredClone(a.engine.data);offline.appointments.push({id:randomUUID(),kind:'block',label:'TESTE OFFLINE',date:'2026-10-24',start:'08:00',end:'09:00',value:0});
  await a.engine.localChanged(offline);await a.engine.sync();assert.equal(a.engine.currentStatus,'Offline');assert.equal(a.saved().meta.dirty,true);assert.ok(!equal((await aDriver.read()).payload,offline));
  a.online(true);await a.engine.sync();await verify('Queda/reconexão simulada com gravação real',a.engine,aDriver,{simulation:'online=false no motor; servidor permaneceu disponível'});
  const realWrite=a.engine.options.write;a.engine.options.write=async()=>{throw new Error('503 SIMULADO');};
  const failure=structuredClone(a.engine.data);failure.clients.find(c=>c.id===clientId).notes+=' Teste de erro recuperado.';
  await a.engine.localChanged(failure);await a.engine.sync();assert.equal(a.engine.currentStatus,'Erro');assert.ok(equal(a.saved().data,failure));
  a.engine.options.write=realWrite;await a.engine.sync();await verify('Erro 503 simulado preserva dados e permite retomada real',a.engine,aDriver);
  await b.engine.prepare();await b.engine.choose('remote');
  const before=await aDriver.read();assert.ok(equal(a.engine.data,b.engine.data));
  const dataA=structuredClone(a.engine.data),dataB=structuredClone(b.engine.data);
  dataA.appointments.push({id:randomUUID(),kind:'block',label:'TESTE CONCORRÊNCIA A',date:'2026-10-24',start:'09:00',end:'10:00',value:0});
  dataB.appointments.push({id:randomUUID(),kind:'block',label:'TESTE CONCORRÊNCIA B',date:'2026-10-24',start:'10:00',end:'11:00',value:0});
  await a.engine.localChanged(dataA);await b.engine.localChanged(dataB);
  let reads=0,release;const gate=new Promise(resolve=>{release=resolve;});
  const synchronizedRead=read=>async()=>{const remote=await read();reads++;if(reads===2)release();await gate;return remote;};
  a.engine.options.read=synchronizedRead(aDriver.read);b.engine.options.read=synchronizedRead(bDriver.read);
  await Promise.all([a.engine.sync(),b.engine.sync()]);
  const after=await aDriver.read();assert.equal(after.revision,before.revision+1);
  const winner=a.engine.currentStatus==='Sincronizado'?a:b;const loser=winner===a?b:a;
  assert.equal(loser.engine.currentStatus,'Conflito');assert.ok(equal(after.payload,winner.engine.data));assert.equal(loser.saved().meta.dirty,true);
  assert.ok(!equal(loser.saved().data,after.payload));fictional(after.payload);
  report.push({label:'Conflito real entre duas sessões (mesma revisão, RPCs concorrentes)',revision:after.revision,winner:'Sincronizado',loser:'Conflito',losingDraftPreserved:true,clients:after.payload.clients.length,appointments:after.payload.appointments.length});
  console.log('PASS conflito REAL, revisão',after.revision,'cópia perdedora preservada');
  await writeFile(new URL('../test-results/conflito-local-ficticio.json',import.meta.url),JSON.stringify(loser.saved(),null,2));
  await writeFile(new URL('../test-results/aula36-integracao.json',import.meta.url),JSON.stringify({project:'dpdxzbbzymkygutwefww',startedRevision:initial.revision,finishedRevision:after.revision,results:report},null,2));
  console.log('PASS',report.length,'verificações de integração; evidências sem credenciais em test-results/.');
} finally {
  for(const token of tokens) {try{await api('/auth/v1/logout?scope=local',{method:'POST',token});}catch{console.log('Logout de sessão de teste não confirmado.');}}
}
