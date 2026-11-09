(() => {
  'use strict';

  function dayAgenda(state, period) {
    const appointments = state.appointments.filter(item => item.date === period &&
      !item.cancelled && !['Cancelado', 'Cancelada', 'cancelled'].includes(item.status));
    return { appointments, blocks: [], reservations: [] };
  }

  function consult(agent, period, state, now = new Date(), filters) {
    if (agent === 'fin') {
      const snapshot = FinCore.project(state, now);
      if (!filters) return { receivedCents: FinCore.report(snapshot, [], period, now).receivedCents };
      const matches = date => date?.startsWith(period) &&
        (filters.weekday === null || new Date(date + 'T00:00:00Z').getUTCDay() === filters.weekday);
      const result = { totalCents: 0, openCents: 0, receivedCents: 0, totalCount: 0, openCount: 0, receivedCount: 0 };
      for (const record of snapshot.records) {
        if (!record.cancelled && matches(record.sessionDate)) {
          result.totalCents += record.amountCents;
          result.totalCount++;
          if (record.status !== 'Pago') {
            result.openCents += record.amountCents;
            result.openCount++;
          }
        }
        if (record.status === 'Pago' && matches(record.paymentDate)) {
          result.receivedCents += record.amountCents;
          result.receivedCount++;
        }
      }
      return result;
    }
    const agenda = dayAgenda(state, period);
    const starts = [];
    for (let hour = 8; hour < 19; hour++) {
      const start = String(hour).padStart(2, '0') + ':00';
      if (AnaPolicy.slotAvailable(agenda, period, start, now.getTime())) starts.push(start);
    }
    return { starts };
  }

  const normalizeName = name => name.normalize('NFD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');

  function prepareBooking(state, { name, date, start, modality }, now, uid) {
    if (typeof name !== 'string' || !name.trim() || name.length > 100 || !FinCore.validDate(date) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !['Presencial', 'Online'].includes(modality)) {
      throw new Error('Não identifiquei nome, data ou horário válidos para agendar.');
    }
    const key = normalizeName(name);
    const exact = state.clients.filter(client => normalizeName(client.name) === key);
    const matches = exact.length ? exact : state.clients.filter(client => normalizeName(client.name).startsWith(key + ' '));
    if (matches.length > 1) return { reply: 'Encontrei mais de um cliente com esse nome. Qual é o nome completo?' };
    const [existing] = matches;
    const agenda = dayAgenda(state, date);
    const duplicate = agenda.appointments.find(item => item.kind === 'appointment' && item.start === start &&
      (existing ? item.clientId === existing.id : normalizeName(item.clientName || '') === key));
    if (duplicate) {
      return { reply: `Esse atendimento já está na Agenda para ${existing?.name || duplicate.clientName}, em ${date.split('-').reverse().join('/')} às ${start}.` };
    }
    if (!AnaPolicy.slotAvailable(agenda, date, start, now.getTime())) {
      const { starts } = consult('ana', date, state, now);
      return { reply: 'Esse horário está ocupado ou fora do expediente ou da antecedência mínima.',
        details: describe('ana', date, { starts }) };
    }
    const client = existing || { id: uid(), name: name.trim().replace(/\s+/g, ' '), phone: '', notes: '', color: 'green', defaultValue: 200 };
    const end = AnaPolicy.timeAt(AnaPolicy.stamp(date, start) + 60 * 60000);
    const appointment = { id: uid(), kind: 'appointment', clientId: client.id, clientName: client.name,
      date, start, end, type: 'Sessão', modality, value: 200, color: client.color || 'green',
      recurrence: 'none', seriesId: null, status: 'Agendado', financialStatus: 'A receber', createdAt: now.toISOString() };
    return {
      state: { ...state, clients: existing ? state.clients : [...state.clients, client], appointments: [...state.appointments, appointment] },
      appointment: { id: appointment.id },
      reply: `Atendimento agendado para ${client.name} em ${date.split('-').reverse().join('/')}, das ${start} às ${end}.`,
      details: `${modality} · 60 min · R$ 200,00 · A receber`,
    };
  }

  async function send(data) {
    let response;
    try {
      response = await fetch('./api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(globalThis.AnaEnvironment?.shared ? 90000 : 50000),
      });
    } catch {
      throw new Error('Sem conexão com a Agenda ou o servidor demorou para responder. Sua pergunta foi preservada.');
    }
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error), { status: response.status });
    return result;
  }

  function describe(agent, period, result) {
    if (agent === 'ana') {
      const date = period.split('-').reverse().join('/');
      return `Horários livres em ${date} (60 min) · ${result.starts.join(', ') || 'Nenhum horário disponível'}`;
    }
    const value = (result.receivedCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    return `Recebimentos em ${period.split('-').reverse().join('/')} · ${value}`;
  }

  function install(getAgenda, book, { refresh, openAppointment } = {}) {
    const byId = id => document.getElementById(id);
    const dialog = byId('agent-chat');
    if (!dialog) return;
    const open = byId('agent-chat-open');
    const openNav = byId('agent-chat-nav');
    const input = byId('agent-chat-message');
    const submit = byId('agent-chat-send');
    const log = byId('agent-chat-log');
    const status = byId('agent-chat-status');
    const login = byId('agent-chat-login');
    const desktop = matchMedia('(min-width: 1000px)');
    const selectors = [...dialog.querySelectorAll('[data-agent]')];
    const conversations = Object.fromEntries(['ana', 'fin'].map(agent => [
      agent, { messages: [], draft: '', busy: false, status: '', expired: false, turns: new Map(), recovering: new Set() },
    ]));
    let selected = 'ana';
    try {
      if (localStorage.getItem('ana-dev-last-agent') === 'fin') selected = 'fin';
    } catch { /* Storage may be unavailable in private browsing. */ }
    const voiceStart = byId('agent-voice-start');
    const quickVoiceLabel = open.querySelector('span');
    const quickVoiceStatus = byId('quick-voice-status');
    let quickVoicePlaybackBlocked = false;

    function showQuickVoiceState({ active, ready, muted, playbackBlocked, mode, message }) {
      const name = selected === 'ana' ? 'Ana' : 'Fin';
      quickVoicePlaybackBlocked = playbackBlocked;
      open.setAttribute('aria-pressed', String(active));
      open.dataset.voiceState = !active ? 'idle' : !ready ? 'connecting' : muted ? 'muted' : 'listening';
      if (quickVoiceLabel) quickVoiceLabel.textContent = playbackBlocked ? 'Ativar áudio' :
        !active ? 'Falar' : !ready ? 'Conectando…' : muted ? name + ' · Silenciado' :
        mode === 'hold' ? name + ' · Segure no chat' : name + ' · Ouvindo';
      if (quickVoiceStatus) quickVoiceStatus.textContent = !active || playbackBlocked ? message : '';
    }
    const voice = globalThis.AgendaHostedConfig?.voice && voiceStart ? globalThis.AgentVoice?.install({
      startButton: voiceStart, status: byId('agent-voice-status'), audio: byId('agent-voice-audio'),
      onEvent: handleVoiceEvent, onState: render, onStatus: showQuickVoiceState,
    }) : undefined;

    function context(thread) {
      return {
        history: thread.messages.slice(-12).map(({ role, content }) => ({ role, content: content.slice(0, 1500) })),
        finContext: thread.finContext,
        pendingRemoval: thread.messages.findLast(item => item.confirmation)?.confirmation,
      };
    }

    function responseDetails(agent, response) {
      const consultation = response.consultation;
      return consultation ? describe(agent, consultation.period, consultation.result) : response.details;
    }

    function addReply(agent, response, details) {
      const thread = conversations[agent];
      if (response.finContext) thread.finContext = response.finContext;
      if (!response.showConfirmation || response.discardConfirmation) {
        for (const item of thread.messages) item.confirmation = null;
      }
      thread.messages.push({ role: 'assistant', content: response.reply, details, appointment: response.appointment,
        confirmation: response.confirmation, review: response.review });
      if (response.showConfirmation && selected === agent) {
        requestAnimationFrame(() => log.querySelector('[data-pending-removal] button')?.scrollIntoView({ block: 'nearest' }));
      }
    }

    function handleVoiceEvent(agent, event) {
      const thread = conversations[agent];
      if (event.type === 'turn') {
        if (thread.turns.has(event.id)) return;
        thread.turns.set(event.id, { session: event.session, pending: true });
        thread.status = 'Consultando o agente…';
        thread.messages.push({ role: 'user', content: event.message });
      } else if (event.type === 'result') {
        const turn = thread.turns.get(event.id);
        if (!turn?.pending) return;
        turn.pending = false;
        thread.status = event.error || '';
        if (event.result) {
          addReply(agent, event.result, responseDetails(agent, event.result));
          if (event.result.changed || event.result.appointment) {
            Promise.resolve().then(() => refresh?.()).catch(() => {
              thread.status = 'Reabra a Agenda para atualizar os atendimentos.';
              if (selected === agent) render();
            });
          }
        }
      } else if (event.type === 'notice') {
        thread.status = event.message;
      } else if (event.type === 'disconnected') {
        thread.recovering.add(event.session);
        thread.status = 'A conexão de voz caiu. Verificando o resultado dos comandos…';
      } else if (['recovery-complete', 'recovery-unknown'].includes(event.type)) {
        thread.recovering.delete(event.session);
        const pending = [...thread.turns.values()].filter(turn => turn.pending && turn.session === event.session);
        for (const turn of pending) turn.pending = false;
        if (event.type === 'recovery-unknown' || pending.length) {
          thread.status = 'Não foi possível confirmar o resultado. Confira a Agenda antes de repetir o pedido.';
        } else if (thread.status.startsWith('A conexão de voz caiu')) {
          thread.status = 'Você pode retomar por voz ou continuar por texto.';
        }
      }
      if (selected === agent) render();
    }

    function busy(thread) {
      return thread.busy || thread.recovering.size > 0 || [...thread.turns.values()].some(turn => turn.pending);
    }

    function startVoice() {
      const thread = conversations[selected];
      if (!voice || voice.active || busy(thread)) return;
      void voice.start(selected, context(thread), 'continuous');
    }

    function toggleVoice() {
      if (!voice) return;
      if (quickVoicePlaybackBlocked) void voice.resumeAudio();
      else if (voice.active) void voice.stop('Voz encerrada.');
      else startVoice();
    }

    voiceStart?.addEventListener('click', toggleVoice);
    dialog.addEventListener('close', () => { if (!dialog.open) render(); });

    function render() {
      const thread = conversations[selected];
      const name = selected === 'ana' ? 'Ana' : 'Fin';
      const title = byId('agent-chat-title');
      if (title) title.textContent = 'Conversa com ' + name;
      log.setAttribute('aria-label', 'Conversa com ' + name);
      log.replaceChildren(...thread.messages.map(message => {
        const { role, content, details, appointment, confirmation, review } = message;
        const entry = document.createElement('div');
        entry.className = 'agent-chat-message';
        entry.dataset.role = role;
        const author = document.createElement('strong');
        author.textContent = role === 'user' ? 'Você' : name;
        const text = document.createElement('p');
        text.textContent = content;
        entry.append(author, text);
        if (details) {
          const facts = document.createElement('small');
          facts.textContent = details;
          entry.append(facts);
        }
        if (review) {
          const scope = document.createElement('p');
          scope.textContent = review.scope;
          const list = document.createElement('details');
          list.className = 'agent-chat-review';
          list.open = review.items.length <= 8;
          const summary = document.createElement('summary');
          summary.textContent = `${review.items.length} ${review.items.length === 1 ? 'atendimento' : 'atendimentos'} · ${review.paid} com pagamento registrado`;
          const items = document.createElement('ul');
          for (const text of review.items) {
            const item = document.createElement('li');
            item.textContent = text;
            items.append(item);
          }
          list.append(summary, items);
          entry.append(scope, list);
        }
        if (appointment && openAppointment) {
          const go = document.createElement('button');
          go.type = 'button';
          go.className = 'secondary-button';
          go.textContent = 'Ver na Agenda';
          go.addEventListener('click', async () => {
            await refresh?.();
            dialog.close();
            openAppointment(appointment.id);
          });
          entry.append(go);
        }
        if (confirmation) {
          entry.dataset.pendingRemoval = '';
          const confirm = document.createElement('button');
          confirm.type = 'button';
          confirm.className = 'danger-button';
          confirm.textContent = 'Confirmar exclusão';
          confirm.disabled = busy(thread);
          confirm.addEventListener('click', async () => {
            if (busy(thread) || !message.confirmation) return;
            void voice?.stop();
            thread.busy = true;
            thread.status = 'Confirmando exclusão…';
            render();
            try {
              const result = await send({ confirmation });
              message.confirmation = null;
              thread.messages.push({ role: 'assistant', content: result.reply });
              thread.status = '';
              if (result.changed) await refresh?.();
            } catch (error) {
              thread.status = error.message;
              thread.expired = error.status === 401;
            } finally {
              thread.busy = false;
              if (conversations[selected] === thread) render();
            }
          });
          entry.append(confirm);
        }
        return entry;
      }));
      log.scrollTop = log.scrollHeight;
      input.value = thread.draft;
      input.readOnly = submit.disabled = busy(thread) || Boolean(voice?.active);
      if (voiceStart && voice) voiceStart.disabled = busy(thread) && !voice.active;
      open.disabled = !voice || (busy(thread) && !voice.active);
      input.placeholder = 'Escreva uma mensagem…';
      status.textContent = thread.status;
      login.hidden = !thread.expired;
      for (const button of selectors) {
        const active = button.dataset.agent === selected;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      }
    }

    const fitViewport = () => {
      if (dialog.open && globalThis.visualViewport) {
        dialog.style.setProperty('--chat-viewport', visualViewport.height + 'px');
        dialog.style.setProperty('--chat-offset', visualViewport.offsetTop + 'px');
      }
    };
    globalThis.visualViewport?.addEventListener('resize', fitViewport);
    globalThis.visualViewport?.addEventListener('scroll', fitViewport);
    desktop.addEventListener('change', () => {
      if (dialog.open) { dialog.close(); showChat(); }
    });
    function showChat() {
      if (dialog.open) return;
      render();
      if (desktop.matches) dialog.show();
      else dialog.showModal();
      log.scrollTop = log.scrollHeight;
      fitViewport();
    }
    open.addEventListener('click', toggleVoice);
    openNav.addEventListener('click', () => {
      const menu = byId('agenda-menu');
      if (menu) menu.open = false;
      showChat();
    });
    open.disabled = !voice;
    openNav.disabled = false;
    byId('agent-chat-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape' && desktop.matches) dialog.close();
    });
    input.addEventListener('input', () => { conversations[selected].draft = input.value; });
    for (const button of selectors) button.addEventListener('click', () => {
      if (selected === button.dataset.agent) return;
      const restartVoice = voice?.active;
      if (restartVoice) void voice.stop();
      selected = button.dataset.agent;
      try { localStorage.setItem('ana-dev-last-agent', selected); }
      catch { /* The selection remains available for this visit. */ }
      if (restartVoice) startVoice();
      render();
    });

    byId('agent-chat-form').addEventListener('submit', async event => {
      event.preventDefault();
      const agent = selected;
      const thread = conversations[agent];
      const message = input.value.trim();
      if (!message || busy(thread) || voice?.active) return;
      thread.draft = message;
      thread.busy = true;
      thread.status = 'Consultando o agente…';
      thread.expired = false;
      render();
      try {
        let response = await send({ agent, message, ...context(thread) });
        let details = responseDetails(agent, response);
        if (agent === 'ana' && response.booking) {
          try { response = await book(response.booking); }
          catch (error) { throw new Error(error.message || 'Não foi possível salvar o atendimento.'); }
          details = response.details;
        } else if (response.id) {
          let result;
          try { result = consult(agent, response.period, getAgenda(), new Date(), response.filters); }
          catch { throw new Error('Não foi possível ler os dados da Agenda para esta consulta.'); }
          if (!response.filters) details = describe(agent, response.period, result);
          response = await send({ id: response.id, result });
        }
        thread.messages.push({ role: 'user', content: message });
        addReply(agent, response, details);
        thread.draft = '';
        thread.status = '';
        if (response.changed || response.appointment) await refresh?.();
      } catch (error) {
        thread.status = error.message;
        thread.expired = error.status === 401;
      } finally {
        thread.busy = false;
        if (selected === agent) render();
      }
    });
  }

  globalThis.AgentChat = Object.freeze({ consult, prepareBooking, install });
})();
