import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, parsePeriod, projectAvailability } from '../supabase/functions/consultar_disponibilidade/handler.js';
const URL='https://dpdxzbbzymkygutwefww.supabase.co';
const fakeToken='fixture.valid.token'; // Somente para testes de dependências; não é JWT utilizável.
const slot={inicio:'14:00',fim:'15:00',inicio_utc:'2026-10-23T17:00:00+00:00',fim_utc:'2026-10-23T18:00:00+00:00'};
function harness(options={}){
  const calls=[];
  const handler=createHandler({projectUrl:URL,publicKey:'public-test-key',fetchImpl:async(url,init)=>{
    calls.push({url,init});
    if(url.endsWith('/auth/v1/user')) return options.authError?new Response('{}',{status:options.authError}):Response.json(options.user||{id:'test-owner',is_anonymous:false});
    if(options.rpcThrow)throw new Error('Dados confidenciais FICTÍCIOS no erro interno');
    if(options.rpcError)return new Response('{"message":"SEGREDO FICTÍCIO INTERNO"}',{status:options.rpcError});
    return Response.json(options.rpc||{revisao:16,dias:[{data:'2026-10-23',horarios:[slot]}]});
  }});
  const request=(body={data:'2026-10-23'},headers={})=>new Request(URL+'/functions/v1/consultar_disponibilidade',{
    method:'POST',headers:{Authorization:'Bearer '+fakeToken,'Content-Type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
  return{handler,calls,request};
}
test('Data única e período real inclusivo, limitado a 31 dias',()=>{
  assert.deepEqual(parsePeriod({data:'2026-10-23'}),{start:'2026-10-23',end:'2026-10-23'});
  assert.deepEqual(parsePeriod({data_inicio:'2026-10-01',data_fim:'2026-10-31'}),{start:'2026-10-01',end:'2026-10-31'});
  for(const body of [{data:'2026-02-30'},{data:'2026-13-01'},{data_inicio:'2026-10-02',data_fim:'2026-10-01'},{data_inicio:'2026-10-01',data_fim:'2026-11-01'},null,[],{data:'2026-10-23',owner_id:'outro-usuario'}])assert.throws(()=>parsePeriod(body));
});
test('Sem autenticação não chega ao Auth nem ao RPC',async()=>{
  const h=harness();const response=await h.handler(new Request(URL,{method:'POST',body:'{}'}));
  assert.equal(response.status,401);assert.equal(h.calls.length,0);
});
test('Token inválido é validado no servidor e recusado',async()=>{
  const h=harness({authError:401});const r=await h.handler(h.request());assert.equal(r.status,401);assert.equal(h.calls.length,1);
});
test('Anonymous Auth também é recusado',async()=>{
  const h=harness({user:{id:'anonymous',is_anonymous:true}});assert.equal((await h.handler(h.request())).status,401);assert.equal(h.calls.length,1);
});
test('Indisponibilidade do Auth não inventa autorização ou horários',async()=>{
  const h=harness({authError:503});const r=await h.handler(h.request());assert.equal(r.status,503);assert.deepEqual(await r.json(),{erro:'AUTENTICACAO_INDISPONIVEL'});
});
test('Consulta válida chama apenas Auth e RPC com o JWT recebido, nunca tabelas',async()=>{
  const h=harness();const r=await h.handler(h.request());assert.equal(r.status,200);
  assert.equal(h.calls.length,2);assert.ok(h.calls[1].url.endsWith('/rpc/consultar_disponibilidade'));
  assert.equal(h.calls[1].init.headers.Authorization,'Bearer '+fakeToken);
  assert.deepEqual(JSON.parse(h.calls[1].init.body),{p_inicio:'2026-10-23',p_fim:'2026-10-23'});
  const result=await r.json();assert.equal(result.fuso_horario,'America/Sao_Paulo');assert.equal(result.dias[0].horarios[0].inicio_utc,'2026-10-23T17:00:00.000Z');
  assert.equal(r.headers.get('Cache-Control'),'no-store');
});
test('Tentativa de escolher outro usuário é recusada antes do banco',async()=>{
  for(const field of ['owner_id','user_id','agenda_owner_id','payload']){
    const h=harness();assert.equal((await h.handler(h.request({data:'2026-10-23',[field]:'outra-conta'}))).status,400);assert.equal(h.calls.length,1);
  }
  const h=harness();const request=h.request();
  const withQuery=new Request(request.url+'?owner_id=outra-conta',request);
  assert.equal((await h.handler(withQuery)).status,400);assert.equal(h.calls.length,1);
});
test('Snapshot ausente/erro interno resulta em erro genérico sem dados internos',async()=>{
  for(const options of [{rpcError:400},{rpcError:500},{rpcThrow:true},{rpc:{revisao:0,dias:[]}}]){
    const h=harness(options);const r=await h.handler(h.request());assert.equal(r.status,503);assert.deepEqual(await r.json(),{erro:'DISPONIBILIDADE_INDISPONIVEL'});
  }
});
test('Resposta usa lista positiva, mesmo se o RPC acrescentar dados de pacientes',()=>{
  const result=projectAvailability({revisao:16,clients:[{name:'TESTE NÃO EXPOR'}],payload:{notes:'FICTÍCIO CONFIDENCIAL'},dias:[{data:'2026-10-23',telefone:'FICTÍCIO',horarios:[{...slot,nome:'TESTE PACIENTE',valor:100}]}]},parsePeriod({data:'2026-10-23'}));
  const text=JSON.stringify(result);assert.doesNotMatch(text,/TESTE|clients|payload|telefone|nome|valor|notes/);
});
test('Metadados/horários incompletos não são devolvidos como disponibilidade',()=>{
  for(const rpc of [{revisao:16,dias:[]},{revisao:16,dias:[{data:'2026-10-24',horarios:[]}]},{revisao:16,dias:[{data:'2026-10-23',horarios:[{...slot,fim_utc:'2026-10-23T17:30:00Z'}]}]}])assert.throws(()=>projectAvailability(rpc,parsePeriod({data:'2026-10-23'})));
});
test('Rejeita métodos de escrita, JSON inválido, payload grande e tipo incorreto',async()=>{
  const h=harness();assert.equal((await h.handler(new Request(URL,{method:'DELETE'}))).status,405);
  assert.equal((await h.handler(h.request('{invalid'))).status,400);
  assert.equal((await h.handler(h.request(' '.repeat(2100)))).status,413);
  assert.equal((await h.handler(h.request('{}',{'Content-Type':'text/plain'}))).status,415);
});
