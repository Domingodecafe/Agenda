/* Regras locais da Ana. Sem dependências, rede ou interpretação de anexos. */
(() => {
  'use strict';
  const HOUR = 3600000;
  const POLICY = Object.freeze({
    version: '1.0', timezone: 'America/Sao_Paulo', duration: 60, minimumHours: 2,
    generalPrice: 200, pix: 'pixipac@gmail.com',
    greeting: 'Olá! Sou a Ana, secretária de IA do psicólogo Henrique. Como posso ajudar?',
    audio: 'Não consigo ouvir arquivos de áudio. Por favor, envie sua mensagem por escrito para que eu possa ajudar.',
    minor: 'O atendimento por este canal será realizado pelo Henrique. Vou encaminhar sua mensagem a ele.',
    suffering: 'Sinto muito que você esteja passando por isso. Vou encaminhar sua mensagem ao Henrique.',
    hours: { 1: [[14,19]], 2: [[8,12],[14,19]], 3: [[8,12],[14,19]], 4: [[8,12],[14,19]], 5: [[14,19]], 6: [[8,12]] },
  });
  const clone = value => structuredClone(value);
  const id = () => globalThis.crypto.randomUUID();
  const stamp = (date, time = '00:00') => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Informe data e horário completos.');
    const value = Date.parse(`${date}T${time}:00-03:00`);
    if (!Number.isFinite(value) || new Date(value - 3 * HOUR).toISOString().slice(0,10) !== date) throw new Error('Data inválida.');
    return value;
  };
  const dateAt = now => new Date(now - 3 * HOUR).toISOString().slice(0,10);
  const timeAt = now => new Date(now - 3 * HOUR).toISOString().slice(11,16);
  const addDays = (date, n) => new Date(stamp(date) + n * 24 * HOUR - 3 * HOUR).toISOString().slice(0,10);
  const week = date => addDays(date, -((new Date(stamp(date)).getUTCDay() + 6) % 7));
  const start = a => stamp(a.date, a.start);
  const end = a => a.end ? stamp(a.date, a.end) : start(a) + HOUR;
  const phone = value => String(value || '').replace(/\D/g, '');
  const money = value => Number(value).toLocaleString('pt-BR', {style:'currency',currency:'BRL'});
  const label = a => `${a.date.split('-').reverse().join('/')} às ${a.start}, ${a.modality}`;
  const active = a => a.status !== 'cancelled';
  const empty = () => ({ version:1, revision:0, clients:[], contacts:[], appointments:[], blocks:[], conversations:{}, requests:[], audit:[], receipts:{}, waitlist:[], reservations:[], outbox:[] });
  function conversation(s, number) {
    return s.conversations[number] ||= {mode:'ana', messages:[], greeted:false, resumeAfter:0};
  }
  function alert(s, number, type, detail, now, patientId = null) {
    const request = {id:id(),number,patientId,type,detail,createdAt:now,status:'pending'};
    s.requests.push(request);
    return request;
  }
  function targets(s, number, financialOnly=false) {
    const own = s.clients.filter(c => c.phone === number).map(c => ({patient:c,financial:!!c.financial}));
    const linked = s.contacts.filter(c => c.phone === number && (financialOnly ? c.financial : c.authorized)).map(c => ({patient:s.clients.find(p => p.id === c.patientId), financial:!!c.financial})).filter(c => c.patient);
    return [...new Map([...own.filter(t=>!financialOnly||t.financial),...linked].map(t => [t.patient.id,t])).values()];
  }
  function resolve(s, number, patientId, financialOnly=false, allowMultiple=false) {
    const list = targets(s,number,financialOnly);
    if (!list.length) return null;
    if (!patientId && list.length > 1) {if(allowMultiple)return null;throw new Error('Para quem é a solicitação? Informe o nome sem listar os vínculos.');}
    const found = patientId ? list.find(t => t.patient.id === patientId) : list[0];
    if (!found) return null;
    return found;
  }
  function slotAvailable(s, date, time, now, {ignoreId, reservationId, duration = POLICY.duration} = {}) {
    const from = stamp(date,time), to = from + duration * 60000;
    const hour = Number(time.slice(0,2)) + Number(time.slice(3))/60;
    if (from < now + 2 * HOUR) return false;
    if (!(POLICY.hours[new Date(from).getUTCDay()] || []).some(([a,b]) => hour >= a && hour + duration / 60 <= b)) return false;
    const overlaps = a => start(a) < to && end(a) > from;
    if (s.appointments.some(a => a.id !== ignoreId && active(a) && overlaps(a)) || s.blocks.some(overlaps)) return false;
    return !s.reservations.some(r => r.id !== reservationId && r.status === 'active' && r.expiresAt > now && overlaps(r));
  }
  function options(s, now, date = dateAt(now), config = {}) {
    stamp(date);
    const result=[];
    for(let day=0;day<31 && result.length<3;day++) {
      const next=addDays(date,day);
      for(let h=8;h<19 && result.length<3;h++) {
        const time=String(h).padStart(2,'0')+':00';
        if (slotAvailable(s,next,time,now,config)) result.push({date:next,start:time});
      }
    }
    return result;
  }
  function enqueue(s, number, text, kind, now, appointmentId) {
    if (conversation(s,number).mode !== 'ana') return;
    s.outbox.push({id:id(),number,text,kind,createdAt:now,appointmentId,status:'local-only'});
  }
  function expire(s, now) {
    for(const r of s.reservations.filter(r => r.status==='active')) {
      if (!targets(s,r.number).some(t=>t.patient.id===r.patientId)) {
        r.status='revoked'; alert(s,r.number,'authorization','Reserva interrompida: autorização removida.',now,r.patientId);
      } else if(s.blocks.some(b=>start(b)<end(r)&&end(b)>start(r))) {
        r.status='blocked'; enqueue(s,r.number,'O horário oferecido foi bloqueado e não está mais disponível.','reservation',now);
      } else if(r.expiresAt<=now) {
        r.status='expired';
        if(r.limit==='lead') enqueue(s,r.number,'O horário não está mais disponível.','reservation',now);
        else { const w=s.waitlist.find(w=>w.patientId===r.patientId); if(w) w.enteredAt=now; }
      }
    }
    for(const c of Object.values(s.conversations)) if(c.cancelUntil && c.cancelUntil<=now) delete c.cancelUntil;
  }
  function book(s, p, number, cmd, now, original) {
    if (!['Presencial','Online'].includes(cmd.modality || original?.modality || p.modality)) throw new Error('Informe a modalidade: Presencial ou Online.');
    const count=cmd.count ?? 1;
    if (![1,2].includes(count) || (original && count!==1)) throw new Error('Escolha uma ou duas sessões consecutivas.');
    if (!slotAvailable(s,cmd.date,cmd.start,now,{ignoreId:original?.id,reservationId:cmd.reservationId})) throw new Error('Horário indisponível ou com menos de duas horas de antecedência. Consulte novas opções.');
    const dates=Array.from({length:count},(_,n)=>({date:cmd.date,start:timeAt(stamp(cmd.date,cmd.start)+n*HOUR)}));
    if(count===2 && !slotAvailable(s,dates[1].date,dates[1].start,now,{reservationId:cmd.reservationId})) throw new Error('Não há duas horas consecutivas. Escolha outro par ou solicite uma sessão.');
    if(p.defaultValue==null) { p.defaultValue=200; alert(s,number,'price','Valor individual ausente: R$ 200 aplicado somente às novas sessões.',now,p.id); }
    const hasRecurring=s.appointments.some(a=>a.clientId===p.id&&active(a)&&a.recurrence&&a.recurrence!=='none'&&start(a)>now);
    const created=dates.map(d=>({id:id(),kind:'appointment',clientId:p.id,clientName:p.name,...d,end:timeAt(stamp(d.date,d.start)+HOUR),modality:cmd.modality||original?.modality||p.modality,value:original?.value??p.defaultValue,status:'scheduled',financialStatus:'A receber',recurrence:'none',extra:original?.extra??hasRecurring,requestedBy:number,createdAt:now}));
    if(original) { original.status='cancelled'; original.replacedBy=created[0].id; }
    s.appointments.push(...created);
    if(p.active===false) { p.active=true; p.frequency='none'; alert(s,number,'return','Cadastro reativado sem restaurar frequência.',now,p.id); }
    for(const r of s.reservations.filter(r=>r.patientId===p.id&&r.status==='active')) r.status='completed';
    s.waitlist=s.waitlist.filter(w=>w.patientId!==p.id);
    return created;
  }
  function admin(s,cmd,now) {
    if(cmd.action==='patient') {
      const number=phone(cmd.phone);
      if(!cmd.name?.trim() || number.length<10 || number.length>15) throw new Error('Nome completo e número com DDD são obrigatórios.');
      if(s.clients.some(p=>p.id!==cmd.id&&p.phone===number)) throw new Error('Esse número já pertence a outro cadastro.');
      if(cmd.defaultValue!=null && (!Number.isFinite(cmd.defaultValue)||cmd.defaultValue<0)) throw new Error('Valor inválido.');
      if(!['Presencial','Online',''].includes(cmd.modality||'')) throw new Error('Modalidade inválida.');
      let p=cmd.id?s.clients.find(p=>p.id===cmd.id):null;
      if(cmd.id&&!p) throw new Error('Cadastro não encontrado.');
      const data={name:cmd.name.trim(),phone:number,preferredName:cmd.preferredName||p?.preferredName||'',defaultValue:cmd.defaultValue??null,modality:cmd.modality||'',minor:!!cmd.minor,financial:!!cmd.financial,active:cmd.active!==false,frequency:cmd.frequency||'none'};
      if(p)Object.assign(p,data); else {p={id:id(),...data};s.clients.push(p);}
      return {text:'Cadastro salvo por Henrique.',patientId:p.id};
    }
    if(cmd.action==='link') {
      if(!s.clients.some(p=>p.id===cmd.patientId)) throw new Error('Cadastro não encontrado.');
      const number=phone(cmd.phone); if(number.length<10||number.length>15) throw new Error('Número com DDD obrigatório.');
      let link=s.contacts.find(c=>c.phone===number&&c.patientId===cmd.patientId);
      const data={phone:number,patientId:cmd.patientId,authorized:cmd.authorized!==false,financial:!!cmd.financial,reminders:!!cmd.reminders,name:cmd.name||''};
      if(link)Object.assign(link,data);else s.contacts.push({id:id(),...data});
      expire(s,now); return {text:'Permissões do contato salvas.'};
    }
    if(['takeover','resume'].includes(cmd.action)) {
      const c=conversation(s,phone(cmd.phone));c.mode=cmd.action==='takeover'?'human':'ana';c.resumeAfter=now;
      for(const o of s.outbox.filter(o=>o.number===phone(cmd.phone)&&o.status==='local-only'))o.status='suppressed';
      return {text:cmd.action==='takeover'?'Atendimento assumido por Henrique.':'Devolvido à Ana. Aguardando nova mensagem.'};
    }
    if(cmd.action==='resolve') {const r=s.requests.find(r=>r.id===cmd.pendingId);if(!r)throw new Error('Pedido não encontrado.');r.status='resolved';return {text:'Pedido resolvido no painel.'};}
    if(cmd.action==='unlock') {const a=s.appointments.find(a=>a.id===cmd.appointmentId);if(!a)throw new Error('Sessão não encontrada.');a.disputed=false;return {text:'Divergência resolvida por Henrique.'};}
    if(cmd.action==='block') {if(stamp(cmd.date,cmd.end)<=stamp(cmd.date,cmd.start))throw new Error('Fim deve ser posterior ao início.');s.blocks.push({id:id(),date:cmd.date,start:cmd.start,end:cmd.end});expire(s,now);return {text:'Bloqueio local registrado.'};}
    throw new Error('Ação administrativa não reconhecida.');
  }
  function tick(s,now) {
    expire(s,now);
    // Janela exata: nenhum envio atrasado é produzido ao reabrir a página.
    for(const a of s.appointments.filter(a=>active(a)&&!a.reminderProcessed)) {
      const due=start(a)-24*HOUR;
      if(now<due)continue;
      a.reminderProcessed=true;
      if(now!==due){a.reminderStatus='missed-no-policy';continue;}
      const p=s.clients.find(p=>p.id===a.clientId);if(!p||p.minor)continue;
      const recipients=[{phone:p.phone,name:p.preferredName||p.name,own:true},...s.contacts.filter(c=>c.patientId===p.id&&c.authorized&&c.reminders)];
      for(const c of recipients) {
        const conv=conversation(s,c.phone);if(conv.mode!=='ana'||due<=conv.resumeAfter)continue;
        enqueue(s,c.phone,`Olá, ${(c.name||'').split(' ')[0]}. Você confirma ${c.own?'seu horário':`o horário de ${(p.preferredName||p.name).split(' ')[0]}`} amanhã, às ${a.start}?`,'reminder',now,a.id);
      }
      a.attendance='awaiting';
    }
    return {text:'Prazos locais processados. Mensagens preparadas permanecem locais.'};
  }
  function offer(s,cmd,now) {
    expire(s,now);
    if(!slotAvailable(s,cmd.date,cmd.start,now))throw new Error('Vaga indisponível.');
    const entries=s.waitlist.slice().sort((a,b)=>a.enteredAt-b.enteredAt);
    const slotKey=cmd.date+'T'+cmd.start;
    const w=entries.find(w=>{
      const p=s.clients.find(p=>p.id===w.patientId);
      return p&&!p.minor&&!(w.offeredSlots||[]).includes(slotKey)&&conversation(s,w.number).mode==='ana'&&targets(s,w.number).some(t=>t.patient.id===p.id)&&!s.reservations.some(r=>r.patientId===p.id&&r.status==='active')&&(!w.dates.length||w.dates.includes(cmd.date))&&(!w.times.length||w.times.includes(cmd.start));
    });
    if(!w)return {text:'Nenhum adulto autorizado na fila compatível com a vaga.'};
    const deadline=start(cmd)-2*HOUR;if(deadline<=now)throw new Error('Não há prazo útil para reserva.');
    const expiresAt=Math.min(now+30*60000,deadline);
    const r={id:id(),patientId:w.patientId,number:w.number,date:cmd.date,start:cmd.start,status:'active',expiresAt,limit:deadline<=now+30*60000?'lead':'timeout',modality:w.modality};
    s.reservations.push(r);enqueue(s,w.number,`Há uma vaga em ${cmd.date.split('-').reverse().join('/')} às ${cmd.start}. A reserva vale até ${timeAt(expiresAt)}.${w.modality==='Ambas'?' Prefere Presencial ou Online?':''}`,'offer',now);
    (w.offeredSlots||=[]).push(slotKey);
    alert(s,w.number,'waitlist','Vaga oferecida no simulador local.',now,w.patientId);
    return {text:'Oferta e reserva preparadas localmente.',reservationId:r.id};
  }
  function advanceQueue(s,now) {
    const freed=[...s.appointments.filter(a=>a.status==='cancelled'),...s.reservations.filter(r=>['expired','declined'].includes(r.status))];
    for(const vacancy of freed.filter(v=>!v.queueProcessed)) {
      vacancy.queueProcessed=true;
      if(slotAvailable(s,vacancy.date,vacancy.start,now))offer(s,{date:vacancy.date,start:vacancy.start},now);
    }
  }
  function execute(input, cmd, now=Date.now()) {
    if(!Number.isFinite(now))throw new Error('Relógio inválido.');
    if(!cmd.requestId||typeof cmd.requestId!=='string')throw new Error('Identificador da solicitação obrigatório.');
    const s=clone(input), fingerprint=JSON.stringify(cmd);
    if(['__proto__','constructor','prototype'].includes(cmd.requestId))throw new Error('Identificador inválido.');
    const receipt=Object.hasOwn(s.receipts,cmd.requestId)?s.receipts[cmd.requestId]:null;
    if(receipt){if(receipt.fingerprint!==fingerprint)throw new Error('Identificador reutilizado para outra solicitação.');return {state:s,result:{...receipt.result,repeated:true}};}
    expire(s,now);
    let result;
    if(cmd.role==='henrique')result=cmd.action==='tick'?tick(s,now):cmd.action==='offer'?offer(s,cmd,now):admin(s,cmd,now);
    else {
      const number=phone(cmd.phone);if(number.length<10||number.length>15)throw new Error('Informe o número da conversa com DDD.');
      const c=conversation(s,number);
      let p;
      c.messages.push({id:cmd.requestId,from:'contact',text:cmd.text||`[${cmd.action}]`,at:now});
      if(c.mode!=='ana')result={text:'',human:true};
      else {
        const patientActions=['preferred-name','finance','availability','sessions','book','reschedule','accept','modality','cancel','stop-treatment','waitlist','leave-waitlist','decline','attendance'];
        const t=resolve(s,number,cmd.patientId,cmd.action==='finance',!patientActions.includes(cmd.action));p=t?.patient;
        if(p?.minor) {c.mode='human';alert(s,number,'minor','Cadastro de menor: atendimento exclusivamente humano.',now,p.id);result={text:POLICY.minor,human:true};}
        else {
          const forward=(type,text,pause=false)=>{alert(s,number,type,cmd.text||cmd.action,now,p?.id);if(pause)c.mode='human';return {text};};
          const needPatient=()=>{if(!p)return forward('first-booking','Vou registrar sua solicitação para Henrique. Informe seu nome completo e sua disponibilidade; o primeiro agendamento depende dele.');};
          const sessions=()=>s.appointments.filter(a=>a.clientId===p.id&&active(a)&&start(a)>now).sort((a,b)=>start(a)-start(b));
          const chosen=()=>{const list=sessions().filter(a=>(!cmd.appointmentId||a.id===cmd.appointmentId)&&(!cmd.date||a.date===cmd.date));return cmd.appointmentId||cmd.date?list:list.slice(0,1);};
          switch(cmd.action) {
            case 'greeting':result={text:POLICY.greeting};break;
            case 'audio':result={text:POLICY.audio};break;
            case 'attachment':result=forward('attachment','Vou encaminhar o arquivo ao Henrique, sem interpretação automática.');break;
            case 'info':result={text:'Henrique é analista do comportamento, psicólogo clínico e terapeuta ABA. Atendimento presencial ou online. IPAC — Rua Pará, 1753, Londrina, Paraná. O valor geral é R$ 200 por sessão de 60 minutos. Localização: https://share.google/V9MFD2qiedeoQIj71 · Instagram: https://www.instagram.com/ipacanalisedocomportamento/'};break;
            case 'pix':result={text:`A chave Pix, tipo e-mail, é ${POLICY.pix}.`};break;
            case 'online-link':result={text:'O acesso da sessão online será enviado pessoalmente por Henrique.'};break;
            case 'preferred-name':if(!p){result=needPatient();break;} if(!cmd.name?.trim())throw new Error('Informe o nome de preferência.');p.preferredName=cmd.name.trim();result={text:'Combinado. Vou usar esse nome nas próximas conversas.'};break;
            case 'human':case 'stop-messages':case 'offensive':result=forward(cmd.action,'Vou encaminhar sua mensagem ao Henrique.',true);break;
            case 'complaint':result=forward('complaint','Entendo seu incômodo. Vou encaminhar sua mensagem ao Henrique.');break;
            case 'suffering':if(!c.riskAt||now-c.riskAt>=24*HOUR){c.riskAt=now;result=forward('immediate-alert',POLICY.suffering);}else result={text:''};break;
            case 'clinical':result=forward('clinical','Vou encaminhar sua pergunta ao Henrique para que ele confirme se pode atender sua demanda.');break;
            case 'discount':result=forward('discount','Pedidos de descontos ou perguntas sobre convênios poderão ser respondidos pelo Henrique. Vou encaminhar sua mensagem a ele.');break;
            case 'document':case 'payment-claim':case 'delete-data':case 'late':case 'other-professional':case 'forward':result=forward(cmd.action,'Vou encaminhar sua solicitação ao Henrique.');break;
            case 'finance':if(!p||!t.financial){result=forward('finance','Vou encaminhar sua solicitação financeira ao Henrique.');break;} {
              const items=s.appointments.filter(a=>a.clientId===p.id&&active(a));
              result={text:`Valor individual: ${money(p.defaultValue??200)}. Total pendente registrado: ${money(items.filter(a=>a.financialStatus!=='Pago').reduce((v,a)=>v+a.value,0))}. Pagamentos registrados: ${items.filter(a=>a.financialStatus==='Pago').length}.`,sessions:items.map(a=>({date:a.date,start:a.start,value:a.value,financialStatus:a.financialStatus}))};break;
            }
            case 'availability':if(!p){result=needPatient();break;}result={text:'Opções disponíveis para escolha. Nenhum horário foi reservado.',options:options(s,now,cmd.date)};break;
            case 'sessions':if(!p){result=needPatient();break;} {const list=sessions().filter(a=>(!cmd.date||week(a.date)===week(cmd.date))&&(!cmd.month||a.date.startsWith(cmd.month)));result={text:list.length?list.map(label).join('\n'):'Não há sessões futuras nesse período.',sessions:list.map(a=>({id:a.id,date:a.date,start:a.start,modality:a.modality}))};break;}
            case 'book':case 'reschedule':case 'accept': {
              if(!p){result=needPatient();break;}
              let original;
              if(cmd.action==='reschedule') {original=sessions().find(a=>a.id===cmd.appointmentId);if(!original)throw new Error('Sessão futura não encontrada.');if(original.disputed)throw new Error('Sessão aguardando decisão de Henrique.');
                if(!original.extra && week(original.date)!==week(cmd.date)) {
                  if(p.frequency==='weekly') {const existing=sessions().filter(a=>week(a.date)===week(cmd.date));result=existing.length?{text:`Você já tem ${existing.map(label).join('; ')}. Deseja uma sessão extra?`,requiresExtra:true}:forward('recurrence','Vou encaminhar a mudança de semana ao Henrique.');break;}
                  if(p.frequency==='biweekly')original=null;
                }
              }
              let actual=cmd;
              if(cmd.action==='accept') {
                const r=s.reservations.find(r=>r.id===cmd.reservationId&&r.patientId===p.id&&r.status==='active');
                if(!r)throw new Error('Reserva encerrada. Consulte novamente a disponibilidade.');
                if(r.modality==='Ambas'&&!cmd.modality)throw new Error('Prefere Presencial ou Online?');
                actual={...cmd,date:r.date,start:r.start,modality:cmd.modality||r.modality};
              }
              const created=book(s,p,number,actual,now,original);
              result={text:`${original?'Remarcação concluída':'Agendamento concluído'}: ${created.map(label).join('; ')}.`,appointmentIds:created.map(a=>a.id)};break;
            }
            case 'modality': {
              if(!p){result=needPatient();break;}const a=chosen()[0];
              if(!a)throw new Error('Sessão futura não encontrada.');if(a.disputed)throw new Error('Sessão aguardando Henrique.');
              if(start(a)<now+2*HOUR)throw new Error('Troca de modalidade exige duas horas de antecedência.');
              if(!['Presencial','Online'].includes(cmd.modality))throw new Error('Modalidade inválida.');
              a.modality=cmd.modality;alert(s,number,'modality',`Modalidade alterada: ${label(a)}`,now,p.id);result={text:`Modalidade alterada: ${label(a)}.`};break;
            }
            case 'cancel':case 'stop-treatment': {
              if(!p){result=needPatient();break;}
              const list=cmd.action==='stop-treatment'?sessions():chosen();
              if(list.some(a=>a.disputed))throw new Error('Há sessão aguardando decisão de Henrique.');
              if(list.some(a=>Object.entries(a.responses||{}).some(([who,keep])=>who!==number&&keep))){for(const a of list)a.disputed=true;result=forward('attendance-conflict','Vou encaminhar a divergência ao Henrique. Alterações dessas sessões ficam pausadas.');break;}
              if(!list.length&&cmd.action==='cancel'){result=forward('cancellation','Não encontrei sessão futura correspondente. Vou encaminhar ao Henrique.');break;}
              for(const a of list){a.status='cancelled';a.cancelledAt=now;a.cancelledBy=number;(a.responses||={})[number]=false;}
              if(cmd.action==='stop-treatment'){p.active=false;p.frequency='none';s.waitlist=s.waitlist.filter(w=>w.patientId!==p.id);for(const r of s.reservations.filter(r=>r.patientId===p.id&&r.status==='active'))r.status='cancelled';result=forward('stop-treatment','Sessões futuras canceladas e cadastro inativado. Henrique será informado.');}
              else {const common=list.some(a=>!a.extra);if(common)c.cancelUntil=now+30*60000;result={text:`Cancelamento concluído: ${list.map(label).join('; ')}.${common?' Deseja remarcar para a mesma semana?':''}`};}
              break;
            }
            case 'pause':case 'travel':result={text:'Quais sessões você deseja cancelar?'};break;
            case 'waitlist':if(!p){result=needPatient();break;}if(!['Presencial','Online','Ambas'].includes(cmd.modality))throw new Error('Informe modalidade da lista de espera.');{
              const dates=cmd.dates||[],times=cmd.times||[];dates.forEach(d=>stamp(d));times.forEach(t=>stamp(dateAt(now),t));
              const existing=s.waitlist.find(w=>w.patientId===p.id);const w={patientId:p.id,number,dates,times,modality:cmd.modality,enteredAt:existing?.enteredAt??now,offeredSlots:existing?.offeredSlots||[]};s.waitlist=s.waitlist.filter(w=>w.patientId!==p.id);s.waitlist.push(w);result={text:'Interesse registrado na lista de espera.'};break;
            }
            case 'leave-waitlist':if(!p){result=needPatient();break;}s.waitlist=s.waitlist.filter(w=>w.patientId!==p.id);for(const r of s.reservations.filter(r=>r.patientId===p.id&&r.status==='active'))r.status='declined';result={text:'Você foi removido da lista de espera.'};break;
            case 'decline':if(!p){result=needPatient();break;}for(const r of s.reservations.filter(r=>r.patientId===p.id&&r.status==='active'))r.status='declined';result={text:'Combinado. Seu interesse e sua posição na lista foram mantidos.'};break;
            case 'attendance': {
              if(!p){result=needPatient();break;}const a=chosen()[0];if(!a)throw new Error('Sessão futura não encontrada.');
              const decision=cmd.confirm!==false;
              a.responses||={};a.responses[number]=decision;
              if(new Set(Object.values(a.responses)).size>1){a.disputed=true;result=forward('attendance-conflict','Vou encaminhar a divergência ao Henrique. Alterações dessa sessão ficam pausadas.');}
              else if(!decision){result={text:'Você deseja cancelar essa sessão?'};}
              else {a.attendance='confirmed';result={text:`Presença confirmada: ${label(a)}.`};}break;
            }
            default: result={text:'Atuo no atendimento administrativo de Henrique. Como posso ajudar em relação à agenda?'};
          }
        }
      }
      if(result.text) {if(!c.greeted&&cmd.action!=='greeting'){result.text=POLICY.greeting+'\n\n'+(p?`${(p.preferredName||p.name).split(' ')[0]}, `:'')+result.text;}c.greeted=true;c.messages.push({id:id(),from:'ana',text:result.text,at:now});}
    }
    advanceQueue(s,now);
    const auditPatient=cmd.patientId||(cmd.phone?targets(s,phone(cmd.phone))[0]?.patient.id:null)||null;
    s.revision++;s.audit.push({id:id(),requestId:cmd.requestId,actor:cmd.role==='henrique'?'henrique':phone(cmd.phone),patientId:auditPatient,action:cmd.action,at:now});
    s.receipts[cmd.requestId]={fingerprint,result:clone(result)};
    return {state:s,result};
  }
  globalThis.AnaPolicy={POLICY,empty,execute,options,slotAvailable,stamp,dateAt,timeAt,targets};
})();
