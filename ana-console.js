(() => {
  'use strict';
  if(!globalThis.AnaEnvironment?.isAllowed())return;
  const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
  let state=AnaPolicy.empty(),busy=false;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=()=>$('#number').value.replace(/\D/g,'');
  const uuid=()=>crypto.randomUUID();
  const actions={greeting:'Apresentação',info:'Informações gerais',pix:'Chave Pix',availability:'Consultar disponibilidade',sessions:'Consultar sessões',book:'Agendar',reschedule:'Remarcar sessão pelo ID',cancel:'Cancelar próxima sessão ou data indicada',modality:'Trocar modalidade',attendance:'Confirmar presença',finance:'Consultar financeiro',waitlist:'Entrar na lista de espera',accept:'Aceitar reserva pelo ID',decline:'Recusar vaga', 'leave-waitlist':'Sair da lista de espera','stop-treatment':'Cancelar todas / interromper atendimento',pause:'Pedir pausa',human:'Falar com Henrique','stop-messages':'Suspender mensagens automáticas',audio:'Receber áudio',attachment:'Receber imagem/documento','payment-claim':'Informar pagamento',document:'Solicitar documento',clinical:'Pergunta clínica',suffering:'Relato de sofrimento',complaint:'Reclamação',discount:'Desconto ou convênio','delete-data':'Pedir exclusão de dados','online-link':'Link da sessão online',late:'Informar atraso','preferred-name':'Alterar nome de preferência',forward:'Encaminhar solicitação'};
  $('#intent').insertAdjacentHTML('beforeend',Object.entries(actions).map(([value,text])=>`<option value="${value}">${text}</option>`).join(''));
  function status(text,error=false){$('#status').textContent=text;$('#status').classList.toggle('error',error);}
  async function send(cmd) {
    if(busy)return;busy=true;
    $$('button').forEach(b=>b.disabled=true);
    try {
      const answer=await AnaLocalStore.dispatch({requestId:uuid(),...cmd});state=answer.state;render();
      status(answer.result.human&&!answer.result.text?'Mensagem registrada. Atendimento sob controle humano.':answer.result.text||'Mensagem registrada.');
      if(answer.result.options)showOptions(answer.result.options);
      return answer.result;
    } catch(error){status(error.message,true);}
    finally{busy=false;$$('button').forEach(b=>b.disabled=false);}
  }
  function fillSelect(selector,items,blank) {
    const el=$(selector),selected=el.value;
    el.innerHTML=(blank?`<option value="">${esc(blank)}</option>`:'')+items.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    if(items.some(p=>p.id===selected))el.value=selected;
  }
  const row=(heading,detail,extra='')=>`<div class="row"><strong>${esc(heading)}</strong><small>${esc(detail)}</small>${extra}</div>`;
  function render() {
    fillSelect('#target',AnaPolicy.targets(state,number()).map(t=>t.patient),'Identificar pelo número');
    fillSelect('#patient-edit',state.clients,'Novo cadastro');fillSelect('#link-patient',state.clients,'Selecione o paciente');
    const c=state.conversations[number()];
    $('#conversation-mode').textContent=c?.mode==='human'?'Henrique assumiu o atendimento':'Ana ativa';
    $('#revision').textContent=`Revisão local ${state.revision}`;
    $('#messages').innerHTML=c?.messages.length?c.messages.map(m=>`<div class="bubble ${m.from==='contact'?'contact':''}"><small>${m.from==='contact'?'Contato fictício':'Ana'}</small>${esc(m.text)}</div>`).join(''):'<p class="empty">A conversa começa aqui. Cadastre um paciente fictício ou consulte as informações gerais como um contato desconhecido.</p>';
    $('#messages').scrollTop=$('#messages').scrollHeight;
    $('#choices').replaceChildren();
    $('#people-list').innerHTML='<h2>Cadastros e vínculos</h2>'+(state.clients.map(p=>row(p.name,`${p.phone} · ${p.minor?'Atendimento humano (menor)':'Adulto'} · ${p.modality||'Modalidade ausente'} · ${p.active?'Ativo':'Inativo'} · Finanças: ${p.financial?'autorizadas':'restritas'}`)+state.contacts.filter(c=>c.patientId===p.id).map(c=>row(`Vínculo: ${c.name||c.phone}`,`${c.phone} · ${c.authorized?'Autorizado':'Revogado'} · Financeiro: ${c.financial?'sim':'não'} · Lembretes: ${c.reminders?'sim':'não'}`)).join('')).join('')||'<p class="empty">Nenhum cadastro de teste.</p>');
    $('#sessions-list').innerHTML=state.appointments.length?state.appointments.slice().sort((a,b)=>(a.date+a.start).localeCompare(b.date+b.start)).map(a=>row(`${a.clientName} · ${a.date} · ${a.start}–${a.end} · ${a.modality}`,`${a.status==='cancelled'?'Cancelada':'Agendada'} · ${a.extra?'Extra · ':''}${a.disputed?'Aguardando Henrique · ':''}${a.attendance==='confirmed'?'Presença confirmada · ':''}ID: ${a.id}`,a.disputed?`<button data-unlock="${esc(a.id)}">Resolver divergência como Henrique</button>`:'')).join(''):'<p class="empty">Nenhuma sessão neste laboratório.</p>';
    $('#reservations-list').innerHTML='<h2>Lista de espera e reservas</h2>'+state.waitlist.map(w=>row(state.clients.find(p=>p.id===w.patientId)?.name,`${w.modality} · Datas: ${w.dates.join(', ')||'qualquer'} · Horários: ${w.times.join(', ')||'qualquer'}`)).join('')+state.reservations.map(r=>row(`${r.date} às ${r.start} · ${r.status}`,`Até ${new Date(r.expiresAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})} · ID: ${r.id}`)).join('')+state.blocks.map(b=>row('Bloqueio',`${b.date} · ${b.start}–${b.end}`)).join('');
    const requests=state.requests.filter(r=>r.status==='pending');$('#pending-count').textContent=requests.length;
    $('#requests-list').innerHTML=requests.length?requests.map(r=>row(`${r.type} · ${r.number}`,r.detail,`<button data-resolve="${esc(r.id)}">Marcar como resolvido</button>`)).join(''):'<p class="empty">Nenhum pedido pendente.</p>';
    $('#outbox-list').innerHTML=state.outbox.length?state.outbox.map(o=>row(`${o.number} · ${o.kind} · ${o.status}`,o.text)).join(''):'<p class="empty">Nenhuma mensagem preparada.</p>';
    $('#audit-list').innerHTML=state.audit.slice(-30).reverse().map(a=>row(`${a.action} · ${a.actor}`,`${new Date(a.at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})} · Solicitação: ${a.requestId}`)).join('')||'<p class="empty">Sem operações registradas.</p>';
  }
  function showOptions(options) {
    const box=$('#choices');box.replaceChildren();
    for(const o of options){const b=document.createElement('button');b.type='button';b.textContent=`${o.date.split('-').reverse().join('/')} às ${o.start}`;b.addEventListener('click',()=>{ $('#date').value=o.date;$('#time').value=o.start;$('#intent').value='book';$('#message').value='Quero esse horário';$('#message').focus();status('Horário selecionado. Processe a mensagem de aceite para gravar.');});box.append(b);}
    if(!options.length)status('Nenhum horário encontrado nos próximos 31 dias. Encaminhe o pedido a Henrique.');
  }
  function interpret(text) {
    const t=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    if(/talvez|nao sei|quem sabe/.test(t)&&/ir|cancel|remarc|sessao/.test(t))return {clarify:'Você deseja cancelar alguma sessão? Informe a data para eu identificar o pedido.'};
    if(/(?:cancel|remarc|agend).*(?: e |tambem).*(?:cancel|remarc|agend)/.test(t))return {action:'forward'};
    if(/parar (?:o )?atendimento|cancel[ae] (?:todas|todos)|cancele tudo/.test(t))return {action:'stop-treatment'};
    if(/nao (?:quero|desejo) (?:mais )?(?:receber )?(?:mensage|lembrete)|pare de (?:me )?(?:mandar|enviar)/.test(t))return {action:'stop-messages'};
    if(/falar com (?:o )?henrique|falar com uma pessoa/.test(t))return {action:'human'};
    if(/pix|como (?:posso )?pagar/.test(t))return {action:'pix'};
    if(/ja paguei|comprovante/.test(t))return {action:'payment-claim'};
    if(/quanto (?:eu )?devo|pendencia|meu saldo|meu pagamento|meu valor/.test(t))return {action:'finance'};
    if(/desconto|convenio|parcel/.test(t))return {action:'discount'};
    if(/recibo|declaracao|atestado/.test(t))return {action:'document'};
    if(/apagar|exclu.*dados/.test(t))return {action:'delete-data'};
    if(/pausa|viaja/.test(t))return {action:'pause'};
    if(/nao vou conseguir ir|cancel/.test(t))return {action:'cancel'};
    if(/remarc/.test(t))return {action:'reschedule'};
    if(/trocar.*(?:online|presencial)|mudar.*modalidade/.test(t))return {action:'modality'};
    if(/confirmo|vou comparecer|presenca/.test(t))return {action:'attendance'};
    if(/minha(?:s)? sess|proxim[ao] (?:sessao|horario|atendimento)/.test(t))return {action:'sessions'};
    if(/sair da lista|nao.*oferta/.test(t))return {action:'leave-waitlist'};
    if(/lista de espera/.test(t))return {action:'waitlist'};
    if(/quero esse horario|agendar|marcar (?:uma |duas )?sess/.test(t))return {action:'book'};
    if(/horario|disponib|vaga/.test(t))return {action:'availability'};
    if(/link.*(?:sessao|online)|acesso online/.test(t))return {action:'online-link'};
    if(/endereco|localiza|valor|preco|quem e henrique|como funciona/.test(t))return {action:'info'};
    if(/^(oi|ola|bom dia|boa tarde|boa noite)[!. ]*$/.test(t))return {action:'greeting'};
    // Sem inferência clínica ou de intenção de alteração a partir de texto desconhecido.
    return {action:'forward'};
  }
  $('#message-form').addEventListener('submit',async event=>{
    event.preventDefault();const text=$('#message').value.trim();let action=$('#intent').value;
    if(action==='auto'){const planned=interpret(text);if(planned.clarify){status(planned.clarify);return;}action=planned.action;}
    const cmd={phone:number(),text,action};if($('#target').value)cmd.patientId=$('#target').value;
    const pickedDate=$('#date').value;
    const brazilDate=text.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
    const explicitDate=text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0]||(brazilDate?`${brazilDate[3]}-${brazilDate[2]}-${brazilDate[1]}`:undefined);
    const explicitTime=text.match(/\b(?:[01]\d|2[0-3]):[0-5]\d\b/)?.[0];
    const date=explicitDate||pickedDate;
    if(['book','reschedule','modality','accept','waitlist'].includes(action))cmd.modality=$('#modality').value;
    if(['book','reschedule','availability'].includes(action)){if(date)cmd.date=date;if(action!=='availability'){cmd.start=explicitTime||$('#time').value;cmd.count=/\bduas sess/i.test(text)?2:Number($('#count').value);}}
    if(['cancel','sessions','modality','attendance'].includes(action)&&date)cmd.date=date;
    const sessionId=$('#session-id').value.trim();
    if(['reschedule','modality','attendance','cancel'].includes(action)&&sessionId)cmd.appointmentId=sessionId;
    if(action==='accept')cmd.reservationId=sessionId;
    if(action==='preferred-name')cmd.name=text;
    if(action==='waitlist'){cmd.dates=date?[date]:[];cmd.times=$('#time').value?[$('#time').value]:[];}
    if($('#intent').value==='auto'&&['book','reschedule','cancel','modality'].includes(action)&&((/\b\d{1,2}\/\d{1,2}\b/.test(text)&&!explicitDate)||(/\b(?:às|as)\s+\d{1,2}\b/i.test(text)&&!explicitTime))){status('Confirme a data completa (DD/MM/AAAA) e o horário (HH:MM). Nenhuma alteração foi realizada.',true);return;}
    if($('#intent').value==='auto'&&['book','reschedule','cancel','modality'].includes(action)&&/\b(?:amanha|quinta|terca|segunda|quarta|sexta|sabado|domingo|hoje)\b/i.test(text)&&!explicitDate){status('Informe a data completa no campo Data antes de usar uma operação estruturada. Datas relativas na mensagem precisam de esclarecimento.',true);return;}
    const result=await send(cmd);if(result)$('#message').value='';
  });
  $$('[data-page]').forEach(button=>button.addEventListener('click',()=>{$$('[data-page]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));$$('.page').forEach(p=>p.hidden=p.id!==button.dataset.page);}));
  $('#number').addEventListener('change',render);
  $('#takeover').addEventListener('click',()=>send({role:'henrique',action:'takeover',phone:number()}));
  $('#resume').addEventListener('click',()=>send({role:'henrique',action:'resume',phone:number()}));
  $('#tick').addEventListener('click',()=>send({role:'henrique',action:'tick'}));
  $('#patient-edit').addEventListener('change',()=>{
    const p=state.clients.find(p=>p.id===$('#patient-edit').value),form=$('#patient-form');
    for(const name of ['name','phone','preferredName','defaultValue','modality','frequency'])form.elements[name].value=p?.[name]??(name==='frequency'?'none':'');
    for(const name of ['minor','financial','active'])form.elements[name].checked=p?!!p[name]:name==='active';
  });
  $('#patient-form').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.target,data=Object.fromEntries(new FormData(form));
    data.defaultValue=data.defaultValue===''?null:Number(data.defaultValue);
    for(const name of ['minor','financial','active'])data[name]=form.elements[name].checked;
    const result=await send({role:'henrique',action:'patient',...data,id:$('#patient-edit').value||undefined});
    if(result?.patientId)$('#patient-edit').value=result.patientId;
  });
  $('#link-form').addEventListener('submit',event=>{event.preventDefault();const form=event.target,data=Object.fromEntries(new FormData(form));for(const name of ['authorized','financial','reminders'])data[name]=form.elements[name].checked;send({role:'henrique',action:'link',...data});});
  for(const [selector,action] of [['#block-form','block'],['#offer-form','offer']])$(selector).addEventListener('submit',event=>{event.preventDefault();send({role:'henrique',action,...Object.fromEntries(new FormData(event.target))});});
  document.addEventListener('click',event=>{const r=event.target.closest('[data-resolve]'),a=event.target.closest('[data-unlock]');if(r)send({role:'henrique',action:'resolve',pendingId:r.dataset.resolve});if(a)send({role:'henrique',action:'unlock',appointmentId:a.dataset.unlock});});
  $('#export').addEventListener('click',()=>{const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));a.href=url;a.download=`ana-dev-laboratorio-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  const p=AnaPolicy.POLICY;
  $('#policy-summary').innerHTML=`<p>${esc(p.greeting)}</p><table><tbody><tr><th>Fuso</th><td>${esc(p.timezone)}</td></tr><tr><th>Sessões</th><td>60 minutos · R$ 200, salvo valor individual</td></tr><tr><th>Segunda e sexta</th><td>14h–19h</td></tr><tr><th>Terça a quinta</th><td>8h–12h e 14h–19h</td></tr><tr><th>Sábado</th><td>8h–12h</td></tr><tr><th>Antecedência</th><td>2 horas para agendar, remarcar ou trocar modalidade</td></tr><tr><th>Reserva</th><td>Até 30 minutos, limitada pela antecedência</td></tr><tr><th>Lembrete</th><td>Exatamente 24 horas antes; simulação local</td></tr></tbody></table>`;
  AnaLocalStore.read().then(s=>{state=s;render();}).catch(e=>status('Não foi possível abrir o laboratório: '+e.message,true));
  window.addEventListener('focus',()=>{if(!busy)AnaLocalStore.read().then(s=>{state=s;render();}).catch(e=>status(e.message,true));});
})();
