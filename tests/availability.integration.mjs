// Testes HTTP de leitura: credenciais somente em stdin, sem eco, sem arquivos de tokens.
import assert from 'node:assert/strict';
import { createInterface } from 'node:readline/promises';
import { writeFile, mkdir } from 'node:fs/promises';
const project='https://dpdxzbbzymkygutwefww.supabase.co';
const endpoint=project+'/functions/v1/consultar_disponibilidade';
if(process.stdin.isTTY)process.stdin.setRawMode(true);
const input=createInterface({input:process.stdin,terminal:false});
console.log('Aguardando configuração de teste em memória, sem eco.');
const credentials=JSON.parse(await input.question(''));input.close();
if(process.stdin.isTTY)process.stdin.setRawMode(false);
let token;
const checks=[];
const headers=()=>({apikey:credentials.key,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})});
async function call(body,extra={}){return fetch(endpoint,{method:'POST',headers:headers(),body:JSON.stringify(body),...extra});}
function safe(value){
  assert.deepEqual(Object.keys(value).sort(),['ambiente','data_fim','data_inicio','dias','duracao_minutos','fuso_horario','revisao'].sort());
  assert.equal(value.fuso_horario,'America/Sao_Paulo');assert.equal(value.duracao_minutos,60);
  for(const day of value.dias){assert.deepEqual(Object.keys(day).sort(),['data','horarios']);
    for(const slot of day.horarios){assert.deepEqual(Object.keys(slot).sort(),['fim','fim_utc','inicio','inicio_utc']);assert.equal(new Date(slot.fim_utc)-new Date(slot.inicio_utc),3600000);}}
  assert.doesNotMatch(JSON.stringify(value),/client|patient|payload|phone|telefone|observa|finance|notes|TESTE|owner_id/i);
}
async function pass(name,action){await action();checks.push(name);console.log('PASS',name);}
try{
  await pass('Sem autenticação é recusado',async()=>{assert.equal((await call({data:'2026-10-23'})).status,401);});
  await pass('Token forjado é recusado',async()=>{assert.equal((await call({data:'2026-10-23'},{headers:{...headers(),Authorization:'Bearer invalid.token.test'}})).status,401);});
  const login=await fetch(project+'/auth/v1/token?grant_type=password',{method:'POST',headers:headers(),body:JSON.stringify({email:credentials.email,password:credentials.password})});
  assert.equal(login.status,200);token=(await login.json()).access_token;
  const readSnapshot=async()=>{const r=await fetch(project+'/rest/v1/agenda_snapshots?select=revision,payload',{headers:headers()});assert.equal(r.status,200);const rows=await r.json();assert.equal(rows.length,1);assert.ok(rows[0].payload.clients.every(c=>/^TESTE/.test(c.name)&&!c.phone));return rows[0];};
  const before=await readSnapshot();
  let demo;
  await pass('Sexta fictícia ocupada 15–16 retorna somente horários livres',async()=>{
    const r=await call({data:'2026-10-23'});assert.equal(r.status,200);demo=await r.json();safe(demo);
    assert.deepEqual(demo.dias[0].horarios.map(s=>s.inicio),['14:00','16:00','17:00','18:00']);
    assert.equal(demo.revisao,before.revision);assert.equal(r.headers.get('Cache-Control'),'no-store');
  });
  await pass('Bloqueios fictícios de sábado são respeitados',async()=>{
    const r=await call({data:'2026-10-24'});assert.equal(r.status,200);const result=await r.json();safe(result);
    assert.deepEqual(result.dias[0].horarios.map(s=>s.inicio),['09:00','11:00']);
  });
  await pass('Domingo não possui atendimento',async()=>{
    const r=await call({data:'2026-10-25'});assert.equal(r.status,200);const result=await r.json();safe(result);assert.equal(result.dias[0].horarios.length,0);
  });
  await pass('Período inclusivo e ocorrência recorrente posterior',async()=>{
    const r=await call({data_inicio:'2026-10-29',data_fim:'2026-10-30'});assert.equal(r.status,200);const result=await r.json();safe(result);
    assert.equal(result.dias.length,2);assert.ok(!result.dias[1].horarios.some(s=>s.inicio==='15:00'));
  });
  await pass('Tentativa autenticada de escolher outro usuário é recusada',async()=>{
    const r=await call({data:'2026-10-23',owner_id:'00000000-0000-4000-8000-000000000001'});assert.equal(r.status,400);assert.deepEqual(await r.json(),{erro:'CONSULTA_INVALIDA'});
    const query=await fetch(endpoint+'?owner_id=00000000-0000-4000-8000-000000000001',{method:'POST',headers:headers(),body:JSON.stringify({data:'2026-10-23'})});assert.equal(query.status,400);
  });
  await pass('Método de escrita e parâmetros inválidos são recusados',async()=>{
    assert.equal((await call({}, {method:'DELETE',body:undefined})).status,405);
    assert.equal((await call({data:'2026-02-30'})).status,400);
    assert.equal((await call({data_inicio:'2026-10-01',data_fim:'2026-12-01'})).status,400);
  });
  await pass('Nenhum snapshot/revisão foi modificado pela API',async()=>{const after=await readSnapshot();assert.deepEqual(after,before);});
  await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});
  await writeFile(new URL('../test-results/aula37-disponibilidade.json',import.meta.url),JSON.stringify({endpoint,checks,snapshotRevision:before.revision,demonstracao:demo},null,2)+'\n');
  console.log('PASS',checks.length,'verificações HTTP; revisão preservada:',before.revision);
  console.log('DEMONSTRAÇÃO',JSON.stringify(demo));
}finally{
  if(token){const logout=await fetch(project+'/auth/v1/logout?scope=local',{method:'POST',headers:headers()});console.log('Logout local:',logout.status);}
}
