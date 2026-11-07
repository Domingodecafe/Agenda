import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../ana-policy.js';
const {empty,execute,stamp,slotAvailable}=globalThis.AnaPolicy;
const now=stamp('2026-10-28','08:00');
const own='5543999990001',linked='5543999990002';
let seq=0;
const run=(s,cmd,at=now)=>execute(s,{requestId:`test-${++seq}`,...cmd},at);
function fixture(){return run(empty(),{role:'henrique',action:'patient',name:'PACIENTE FICTÍCIO',phone:own,modality:'Presencial',defaultValue:150,financial:false}).state;}
function contact(s,action,extra={},at=now){return run(s,{phone:own,patientId:s.clients[0].id,action,...extra},at);}
function booked(){return contact(fixture(),'book',{date:'2026-10-29',start:'14:00'}).state;}

test('informações gerais e Pix não exigem cadastro; financeiro individual exige autorização',()=>{
  const info=run(empty(),{phone:linked,action:'info'});assert.match(info.result.text,/R\$ 200/);
  assert.match(run(empty(),{phone:linked,action:'pix'}).result.text,/pixipac@gmail.com/);
  const s=booked(),r=contact(s,'finance');assert.ok(!r.result.text.includes('150'));assert.equal(r.state.requests[0].type,'finance');
});
test('nome e ID informados por desconhecido não autorizam leitura ou alteração',()=>{
  const s=booked(),r=run(s,{phone:linked,patientId:s.clients[0].id,action:'cancel',text:'Sou PACIENTE FICTÍCIO'});
  assert.equal(r.state.appointments[0].status,'scheduled');assert.equal(r.state.requests[0].type,'first-booking');
});
test('vínculo autorizado agenda sem obter financeiro; revogação bloqueia alterações',()=>{
  let s=fixture();s=run(s,{role:'henrique',action:'link',patientId:s.clients[0].id,phone:linked,authorized:true}).state;
  s=run(s,{phone:linked,action:'book',date:'2026-10-29',start:'14:00'}).state;
  assert.equal(s.appointments[0].requestedBy,linked);
  s=run(s,{role:'henrique',action:'link',patientId:s.clients[0].id,phone:linked,authorized:false}).state;
  assert.equal(run(s,{phone:linked,action:'cancel'}).state.appointments[0].status,'scheduled');
});
test('menor prevalece sobre vínculo, emite uma mensagem e passa ao humano',()=>{
  let s=fixture();s.clients[0].minor=true;
  const first=contact(s,'book',{date:'2026-10-29',start:'14:00'});
  assert.equal(first.state.appointments.length,0);assert.match(first.result.text,/realizado pelo Henrique/);
  const second=contact(first.state,'info');assert.equal(second.result.text,'');assert.equal(second.state.requests.length,1);
});
test('expediente, antecedência, bloqueios e sobreposições são validados',()=>{
  const s=booked();
  for(const [date,time] of [['2026-10-28','09:00'],['2026-11-01','14:00'],['2026-10-30','09:00'],['2026-10-29','13:30'],['2026-10-29','18:30'],['2026-10-29','14:30']])assert.equal(slotAvailable(s,date,time,now),false,`${date} ${time}`);
  assert.equal(slotAvailable(s,'2026-10-28','10:00',now),true);
  s.blocks.push({date:'2026-10-29',start:'16:00',end:'17:00'});assert.equal(slotAvailable(s,'2026-10-29','16:00',now),false);
});
test('data inexistente e horário ambíguo são rejeitados',()=>{
  assert.throws(()=>stamp('2026-02-30','14:00'),/inválida/);assert.throws(()=>stamp('2026-10-29','3'),/completos/);
});
test('repetição idempotente e reutilização inválida do identificador',()=>{
  const s=fixture(),cmd={requestId:'same',phone:own,action:'book',date:'2026-10-29',start:'14:00'};
  const a=execute(s,cmd,now),b=execute(a.state,cmd,now);
  assert.equal(b.state.appointments.length,1);assert.equal(b.result.repeated,true);
  assert.throws(()=>execute(a.state,{...cmd,start:'15:00'},now),/reutilizado/);
});
test('remarcação em horário ocupado preserva original e não modifica entrada',()=>{
  const s=booked();s.blocks.push({date:'2026-10-29',start:'16:00',end:'17:00'});const before=structuredClone(s);
  assert.throws(()=>contact(s,'reschedule',{appointmentId:s.appointments[0].id,date:'2026-10-29',start:'16:00'}),/indisponível/);
  assert.deepEqual(s,before);
  const r=contact(s,'reschedule',{appointmentId:s.appointments[0].id,date:'2026-10-29',start:'15:00'});
  assert.equal(r.state.appointments[0].status,'cancelled');assert.equal(r.state.appointments[1].value,150);
});
test('duas sessões consecutivas são atômicas e possuem valores individuais',()=>{
  const s=fixture();const r=contact(s,'book',{date:'2026-10-29',start:'14:00',count:2});
  assert.deepEqual(r.state.appointments.map(a=>a.start),['14:00','15:00']);assert.deepEqual(r.state.appointments.map(a=>a.value),[150,150]);
  assert.throws(()=>contact(s,'book',{date:'2026-10-29',start:'18:00',count:2}),/duas horas/);assert.equal(s.appointments.length,0);
});
test('cancelamento em menos de duas horas é permitido, passado é preservado',()=>{
  const s=booked();const r=contact(s,'cancel',{},stamp('2026-10-29','13:59'));assert.equal(r.state.appointments[0].status,'cancelled');
  assert.match(r.result.text,/mesma semana/);
  const past=contact(s,'cancel',{},stamp('2026-10-29','14:01'));assert.equal(past.state.appointments[0].status,'scheduled');assert.equal(past.state.requests.length,1);
});
test('cancelar data com duas sessões cancela ambas; cancelar extra não oferece remarcação',()=>{
  let s=contact(fixture(),'book',{date:'2026-10-29',start:'14:00',count:2}).state;
  assert.ok(contact(s,'cancel',{date:'2026-10-29'}).state.appointments.every(a=>a.status==='cancelled'));
  s.appointments[0].extra=true;assert.ok(!contact(s,'cancel',{appointmentId:s.appointments[0].id}).result.text.includes('Deseja remarcar'));
});
test('interrupção preserva histórico financeiro e retorno não restaura frequência',()=>{
  let s=booked();s.clients[0].frequency='weekly';s.appointments[0].financialStatus='Pago';
  s=contact(s,'stop-treatment').state;assert.equal(s.clients[0].active,false);assert.equal(s.appointments[0].financialStatus,'Pago');
  s=contact(s,'book',{date:'2026-10-30',start:'14:00'}).state;assert.equal(s.clients[0].active,true);assert.equal(s.clients[0].frequency,'none');assert.equal(s.appointments[1].value,150);
});
test('preço ausente aplica 200 às novas sessões e alerta Henrique',()=>{
  const s=fixture();s.clients[0].defaultValue=null;const r=contact(s,'book',{date:'2026-10-29',start:'14:00'});assert.equal(r.state.appointments[0].value,200);assert.equal(r.state.requests[0].type,'price');
});
test('controle humano suspende somente o contato e devolução aguarda mensagem nova',()=>{
  let s=fixture();s=run(s,{role:'henrique',action:'takeover',phone:own}).state;
  assert.equal(contact(s,'book',{date:'2026-10-29',start:'14:00'}).state.appointments.length,0);
  s=run(s,{role:'henrique',action:'resume',phone:own}).state;assert.equal(s.outbox.length,0);
  assert.equal(contact(s,'book',{date:'2026-10-29',start:'14:00'}).state.appointments.length,1);
});
test('reserva exclusiva, prazo limitado pela antecedência e aceite sem confirmação extra',()=>{
  let s=contact(fixture(),'waitlist',{modality:'Online'}).state;
  const at=stamp('2026-10-28','13:50');
  s=run(s,{role:'henrique',action:'offer',date:'2026-10-28',start:'16:00'},at).state;
  const r=s.reservations[0];assert.equal(r.expiresAt,stamp('2026-10-28','14:00'));assert.equal(r.limit,'lead');
  assert.equal(slotAvailable(s,r.date,r.start,at),false);
  const accepted=contact(s,'accept',{reservationId:r.id},at+60000);assert.equal(accepted.state.appointments.length,1);assert.equal(accepted.state.waitlist.length,0);
  assert.equal(accepted.state.appointments[0].modality,'Online');
});
test('expiração comum é silenciosa e move paciente ao fim da fila',()=>{
  let s=contact(fixture(),'waitlist',{modality:'Presencial'}).state;s=run(s,{role:'henrique',action:'offer',date:'2026-10-29',start:'14:00'}).state;
  const n=s.outbox.length;s=run(s,{role:'henrique',action:'tick'},now+31*60000).state;assert.equal(s.reservations[0].status,'expired');assert.equal(s.outbox.length,n);assert.equal(s.waitlist[0].enteredAt,now+31*60000);
});
test('remoção de vínculo e bloqueio interrompem reservas',()=>{
  let s=fixture();s=run(s,{role:'henrique',action:'link',patientId:s.clients[0].id,phone:linked}).state;
  s=run(s,{phone:linked,action:'waitlist',modality:'Online'}).state;s=run(s,{role:'henrique',action:'offer',date:'2026-10-29',start:'14:00'}).state;
  const revoked=run(s,{role:'henrique',action:'link',patientId:s.clients[0].id,phone:linked,authorized:false});assert.equal(revoked.state.reservations[0].status,'revoked');
  const blocked=run(s,{role:'henrique',action:'block',date:'2026-10-29',start:'14:00',end:'15:00'});assert.equal(blocked.state.reservations[0].status,'blocked');
});
test('lembrete somente no instante de 24h e nunca atrasado; pausa impede preparo',()=>{
  const s=booked(),due=stamp('2026-10-28','14:00');
  const r=run(s,{role:'henrique',action:'tick'},due);assert.equal(r.state.outbox.length,1);assert.match(r.state.outbox[0].text,/confirma seu horário amanhã/);
  assert.equal(run(r.state,{role:'henrique',action:'tick'},due).state.outbox.length,1);
  assert.equal(run(s,{role:'henrique',action:'tick'},due+1).state.outbox.length,0);
  const paused=run(s,{role:'henrique',action:'takeover',phone:own},due-1000).state;assert.equal(run(paused,{role:'henrique',action:'tick'},due).state.outbox.length,0);
});
test('divergência de presença pausa sessão até resolução de Henrique',()=>{
  let s=booked();s=run(s,{role:'henrique',action:'link',patientId:s.clients[0].id,phone:linked}).state;
  s=contact(s,'attendance',{confirm:true}).state;s=run(s,{phone:linked,action:'attendance',confirm:false}).state;
  assert.equal(s.appointments[0].disputed,true);assert.throws(()=>contact(s,'cancel'),/aguardando/);
});
test('comprovantes não alteram financeiro e áudios não são interpretados',()=>{
  const s=booked(),r=contact(s,'payment-claim');assert.equal(r.state.appointments[0].financialStatus,'A receber');assert.equal(r.state.requests[0].type,'payment-claim');assert.match(contact(s,'audio').result.text,/Não consigo ouvir/);
});
test('resolve pedido pendente com identificador separado do recibo de operação',()=>{
  let s=contact(fixture(),'document').state;s=run(s,{role:'henrique',action:'resolve',pendingId:s.requests[0].id}).state;assert.equal(s.requests[0].status,'resolved');
});

test('autorização financeira de responsável independe de permissão de agendar',()=>{
  let s=booked();s=run(s,{role:'henrique',action:'link',patientId:s.clients[0].id,phone:linked,authorized:false,financial:true}).state;
  assert.match(run(s,{phone:linked,action:'finance'}).result.text,/150/);
  assert.equal(run(s,{phone:linked,action:'cancel'}).state.appointments[0].status,'scheduled');
});
test('cancelamento libera vaga e prepara oferta para primeiro interessado elegível',()=>{
  let s=booked();s=run(s,{role:'henrique',action:'patient',name:'SEGUNDO TESTE',phone:linked,modality:'Online'}).state;
  s=run(s,{phone:linked,action:'waitlist',modality:'Online'}).state;
  const r=contact(s,'cancel');assert.equal(r.state.reservations.length,1);assert.equal(r.state.reservations[0].number,linked);
});
test('expiração passa a oferta à próxima pessoa sem oferecer novamente a mesma vaga',()=>{
  let s=fixture();s=run(s,{role:'henrique',action:'patient',name:'SEGUNDO TESTE',phone:linked,modality:'Online'}).state;
  s=contact(s,'waitlist',{modality:'Online'}).state;s=run(s,{phone:linked,action:'waitlist',modality:'Online'},now+1).state;
  s=run(s,{role:'henrique',action:'offer',date:'2026-10-29',start:'14:00'},now+2).state;
  s=run(s,{role:'henrique',action:'tick'},now+31*60000).state;
  assert.equal(s.reservations.length,2);assert.equal(s.reservations[1].number,linked);
});
test('cancelamento conflitante com confirmação de outro contato aguarda Henrique',()=>{
  let s=booked();s=run(s,{role:'henrique',action:'link',patientId:s.clients[0].id,phone:linked}).state;
  s=contact(s,'attendance').state;
  const r=run(s,{phone:linked,action:'cancel'});assert.equal(r.state.appointments[0].disputed,true);assert.equal(r.state.appointments[0].status,'scheduled');
});
