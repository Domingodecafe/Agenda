(() => {
  'use strict';

  const DB_NAME = 'agenda-1-0-db';
  const STORE = 'agenda';
  const STATE_KEY = 'main';
  const HOURS_START = 8;
  const HOURS_END = 20;
  const weekdays = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
  const months = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const emptyState = { clients: [], appointments: [], settings: { view: 'week' } };
  let state = structuredClone(emptyState);
  let activeTab = 'agenda';
  let anchorDate = new Date();
  let deferredInstall = null;
  let storageMode = 'indexedDB';
  let toastTimer;

  const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const pad = value => String(value).padStart(2, '0');
  const isoDate = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const parseDate = value => { const [y,m,d] = value.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (date, amount) => { const copy = new Date(date); copy.setDate(copy.getDate() + amount); return copy; };
  const addMonths = (date, amount) => { const copy = new Date(date); const day = copy.getDate(); copy.setDate(1); copy.setMonth(copy.getMonth() + amount); copy.setDate(Math.min(day, new Date(copy.getFullYear(), copy.getMonth() + 1, 0).getDate())); return copy; };
  const startOfWeek = date => { const copy = new Date(date); const offset = (copy.getDay() + 6) % 7; copy.setDate(copy.getDate() - offset); copy.setHours(0,0,0,0); return copy; };
  const timeMinutes = value => { const [h,m] = value.split(':').map(Number); return h * 60 + m; };
  const formatMoney = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const hashColor = text => [...String(text)].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 3;

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function loadState() {
    try {
      const db = await openDatabase();
      const value = await new Promise((resolve, reject) => {
        const request = db.transaction(STORE).objectStore(STORE).get(STATE_KEY);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.close();
      state = value || structuredClone(emptyState);
    } catch (error) {
      storageMode = 'localStorage';
      try { state = JSON.parse(localStorage.getItem('agenda-1-0-state')) || structuredClone(emptyState); }
      catch { state = structuredClone(emptyState); }
    }
    state.clients ||= [];
    state.appointments ||= [];
    state.settings ||= { view: 'week' };
  }

  async function saveState() {
    try {
      if (storageMode === 'localStorage') throw new Error('fallback');
      const db = await openDatabase();
      await new Promise((resolve, reject) => {
        const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(state, STATE_KEY);
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
      });
      db.close();
    } catch {
      storageMode = 'localStorage';
      localStorage.setItem('agenda-1-0-state', JSON.stringify(state));
    }
  }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
  }

  function setTab(tab) {
    activeTab = tab;
    $$('.screen').forEach(screen => screen.classList.toggle('active', screen.id === `${tab}-screen`));
    $$('.bottom-nav button').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
    $('#fab').classList.toggle('hidden', tab !== 'agenda');
    $('#today-header').classList.toggle('hidden', tab !== 'agenda');
    if (tab === 'clients') renderClients();
    if (tab === 'summary') renderSummary();
  }

  function setView(view) {
    state.settings.view = view;
    $$('.segmented button').forEach(button => button.classList.toggle('active', button.dataset.view === view));
    saveState();
    renderCalendar();
  }

  function relevantEvents(date) {
    const target = isoDate(date);
    return state.appointments.filter(item => item.date === target).sort((a,b) => a.start.localeCompare(b.start));
  }

  function eventClass(item) {
    if (item.kind === 'block') return 'block';
    const classes = [`event-${eventColor(item)}`];
    if (item.status === 'Cancelado') classes.push('status-cancelled');
    if (item.status === 'Realizado') classes.push('status-done');
    if (item.status === 'Faltou') classes.push('status-missed');
    if (item.status === 'Remarcado') classes.push('status-rescheduled');
    return classes.join(' ');
  }

  function eventColor(item) {
    if (item.kind === 'block') return 'neutral';
    const client = state.clients.find(entry => entry.id === item.clientId);
    return item.color || client?.color || ['green', 'purple', 'yellow'][hashColor(item.clientName)];
  }

  function eventCard(item) {
    const start = Math.max(timeMinutes(item.start), HOURS_START * 60);
    const end = Math.min(timeMinutes(item.end), HOURS_END * 60);
    if (end <= HOURS_START * 60 || start >= HOURS_END * 60) return '';
    const top = 68 + start - HOURS_START * 60;
    const height = Math.max(26, end - start - 2);
    const title = item.kind === 'block' ? item.label || 'Horário bloqueado' : item.clientName;
    const subtitle = item.kind === 'block' ? `${item.start} — ${item.end}` : `${item.start} · ${item.modality}`;
    return `<button class="event-card ${eventClass(item)}" data-event-id="${item.id}" style="top:${top}px;height:${height}px" type="button" title="${escapeHTML(title)}"><b>${escapeHTML(title)}</b><span>${escapeHTML(subtitle)}</span></button>`;
  }

  function timeAxis() {
    let html = '<div class="time-axis">';
    for (let h = HOURS_START; h <= HOURS_END; h += 1) html += `<span class="time-label" style="top:${(h-HOURS_START)*60}px">${pad(h)}:00</span>`;
    return `${html}</div>`;
  }

  function renderWeek() {
    const monday = startOfWeek(anchorDate);
    let html = `<div class="week-view">${timeAxis()}`;
    for (let index = 0; index < 7; index += 1) {
      const date = addDays(monday, index);
      const today = isoDate(date) === isoDate(new Date());
      html += `<div class="day-column ${today ? 'today' : ''}" data-date="${isoDate(date)}">
        <div class="day-head"><span>${weekdays[date.getDay()]}</span><b>${date.getDate()}</b></div>
        <div class="day-hit-area" data-date="${isoDate(date)}"></div>${relevantEvents(date).map(eventCard).join('')}</div>`;
    }
    $('#calendar').innerHTML = `${html}</div>`;
  }

  function renderDay() {
    const today = isoDate(anchorDate) === isoDate(new Date());
    $('#calendar').innerHTML = `<div class="day-view">${timeAxis()}<div class="day-lane ${today ? 'today' : ''}">
      <div class="day-head"><b>${anchorDate.toLocaleDateString('pt-BR', {weekday:'long', day:'2-digit', month:'long'})}</b></div>
      <div class="day-hit-area" data-date="${isoDate(anchorDate)}"></div>${relevantEvents(anchorDate).map(eventCard).join('')}</div></div>`;
  }

  function renderMonth() {
    const first = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
    const gridStart = startOfWeek(first);
    const headings = ['SEG','TER','QUA','QUI','SEX','SÁB','DOM'].map(day => `<div class="month-weekday">${day}</div>`).join('');
    let cells = '';
    for (let index = 0; index < 42; index += 1) {
      const date = addDays(gridStart, index);
      const events = relevantEvents(date);
      const classes = `${date.getMonth() !== anchorDate.getMonth() ? 'outside' : ''} ${isoDate(date) === isoDate(new Date()) ? 'today' : ''}`;
      cells += `<div class="month-day ${classes}" data-date="${isoDate(date)}"><span class="month-number">${date.getDate()}</span><div class="month-events">
        ${events.slice(0,3).map(item => `<button class="month-event event-${eventColor(item)} ${item.financialStatus === 'Pago' ? 'paid' : ''}" data-event-id="${item.id}" type="button">${escapeHTML(item.start)} · ${escapeHTML(item.kind === 'block' ? item.label || 'Bloqueio' : item.clientName)}</button>`).join('')}
        ${events.length > 3 ? `<span class="month-more">+ ${events.length - 3} outro(s)</span>` : ''}</div></div>`;
    }
    $('#calendar').innerHTML = `<div class="month-view">${headings}${cells}</div>`;
  }

  function updatePeriodLabel() {
    const view = state.settings.view;
    if (view === 'week') {
      const first = startOfWeek(anchorDate), last = addDays(first, 6);
      $('#period-primary').textContent = first.getMonth() === last.getMonth() ? months[first.getMonth()] : `${months[first.getMonth()]} — ${months[last.getMonth()]}`;
      $('#period-secondary').textContent = `${first.getDate()}–${last.getDate()} · ${last.getFullYear()}`;
    } else if (view === 'month') {
      $('#period-primary').textContent = months[anchorDate.getMonth()];
      $('#period-secondary').textContent = anchorDate.getFullYear();
    } else {
      $('#period-primary').textContent = anchorDate.toLocaleDateString('pt-BR', {day:'2-digit', month:'long'});
      $('#period-secondary').textContent = anchorDate.getFullYear();
    }
  }

  function renderCalendar() {
    updatePeriodLabel();
    if (state.settings.view === 'day') renderDay();
    else if (state.settings.view === 'month') renderMonth();
    else renderWeek();
  }

  function navigateDate(direction) {
    if (state.settings.view === 'day') anchorDate = addDays(anchorDate, direction);
    else if (state.settings.view === 'week') anchorDate = addDays(anchorDate, direction * 7);
    else anchorDate = addMonths(anchorDate, direction);
    renderCalendar();
  }

  function populateClientOptions() {
    $('#client-options').innerHTML = state.clients.sort((a,b) => a.name.localeCompare(b.name)).map(client => `<option value="${escapeHTML(client.name)}"></option>`).join('');
  }

  function oneHourAfter(start) {
    if (!start) return '';
    const total = Math.min(timeMinutes(start) + 60, (24 * 60) - 1);
    return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
  }

  function updateEndFromStart() {
    const calculatedEnd = oneHourAfter($('#appointment-start').value);
    if (calculatedEnd) $('#appointment-end').value = calculatedEnd;
  }

  function setSelectedColor(scope, color = 'green') {
    $(`#${scope}-color`).value = color;
    $$(`[data-color-picker="${scope}"] button`).forEach(button => {
      const selected = button.dataset.color === color;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }

  function resetAppointmentForm(date = isoDate(anchorDate), start = '09:00') {
    $('#appointment-form').reset();
    $('#appointment-id').value = '';
    $('#appointment-kind').value = 'appointment';
    $('#appointment-date').value = date;
    $('#appointment-start').value = start;
    $('#appointment-end').value = oneHourAfter(start);
    $('#appointment-value').value = '0';
    setSelectedColor('appointment', 'green');
    $('#appointment-title').textContent = 'Novo atendimento';
    $('#appointment-kicker').textContent = 'NOVO';
    $('#edit-status-fields').classList.add('hidden');
    $('#delete-appointment').classList.add('hidden');
    $('#reschedule-appointment').classList.add('hidden');
    $('#appointment-recurrence').disabled = false;
    $('#form-error').textContent = '';
    setAppointmentKind('appointment');
    populateClientOptions();
  }

  function setAppointmentKind(kind) {
    $('#appointment-kind').value = kind;
    $$('.type-toggle button').forEach(button => button.classList.toggle('active', button.dataset.kind === kind));
    $('#appointment-fields').classList.toggle('hidden', kind === 'block');
    $('#appointment-extra').classList.toggle('hidden', kind === 'block');
    $('#block-label-wrap').classList.toggle('hidden', kind !== 'block');
    $('#appointment-client').required = kind === 'appointment';
    $('#appointment-title').textContent = $('#appointment-id').value ? (kind === 'block' ? 'Editar bloqueio' : 'Editar atendimento') : (kind === 'block' ? 'Novo bloqueio' : 'Novo atendimento');
  }

  function openNewAppointment(date, start) {
    resetAppointmentForm(date, start);
    $('#appointment-dialog').showModal();
  }

  function openEditAppointment(id) {
    const item = state.appointments.find(event => event.id === id);
    if (!item) return;
    resetAppointmentForm(item.date, item.start);
    $('#appointment-id').value = item.id;
    $('#appointment-kind').value = item.kind;
    $('#appointment-client').value = item.clientName || '';
    $('#appointment-type').value = item.type || 'Consulta';
    $('#appointment-modality').value = item.modality || 'Presencial';
    $('#appointment-date').value = item.date;
    $('#appointment-start').value = item.start;
    $('#appointment-end').value = item.end;
    $('#appointment-value').value = item.value || 0;
    setSelectedColor('appointment', item.color || eventColor(item));
    $('#appointment-status').value = item.status || 'Agendado';
    $('#financial-status').value = item.financialStatus || 'A receber';
    $('#block-label').value = item.label || '';
    $('#appointment-title').textContent = item.kind === 'block' ? 'Editar bloqueio' : 'Editar atendimento';
    $('#appointment-kicker').textContent = 'DETALHES';
    $('#edit-status-fields').classList.toggle('hidden', item.kind === 'block');
    $('#delete-appointment').classList.remove('hidden');
    $('#reschedule-appointment').classList.toggle('hidden', item.kind === 'block' || item.status === 'Remarcado');
    $('#appointment-recurrence').value = 'none';
    $('#appointment-recurrence').disabled = true;
    setAppointmentKind(item.kind);
    $('#appointment-dialog').showModal();
  }

  function recurrenceDates(date, frequency) {
    const result = [parseDate(date)];
    if (frequency === 'none') return result;
    const count = frequency === 'weekly' ? 52 : frequency === 'biweekly' ? 26 : 12;
    for (let index = 1; index < count; index += 1) {
      result.push(frequency === 'monthly' ? addMonths(result[0], index) : addDays(result[0], index * (frequency === 'biweekly' ? 14 : 7)));
    }
    return result;
  }

  async function submitAppointment(event) {
    event.preventDefault();
    const id = $('#appointment-id').value;
    const kind = $('#appointment-kind').value;
    const date = $('#appointment-date').value;
    const start = $('#appointment-start').value;
    const end = $('#appointment-end').value;
    if (!date || !start || !end || timeMinutes(end) <= timeMinutes(start)) {
      $('#form-error').textContent = 'Confira a data e informe um horário final posterior ao inicial.'; return;
    }
    if (kind === 'appointment' && !$('#appointment-client').value.trim()) {
      $('#form-error').textContent = 'Informe o nome do cliente.'; return;
    }
    let client = null;
    if (kind === 'appointment') {
      const clientName = $('#appointment-client').value.trim();
      client = state.clients.find(item => item.name.toLocaleLowerCase() === clientName.toLocaleLowerCase());
      if (!client) {
        client = { id: uid(), name: clientName, phone: '', defaultValue: Number($('#appointment-value').value || 0), notes: '', color: $('#appointment-color').value };
        state.clients.push(client);
      }
    }
    if (id) {
      const item = state.appointments.find(entry => entry.id === id);
      Object.assign(item, {
        kind, date, start, end,
        label: $('#block-label').value.trim(),
        clientId: client?.id || null, clientName: client?.name || '',
        type: $('#appointment-type').value, modality: $('#appointment-modality').value,
        value: Number($('#appointment-value').value || 0), color: $('#appointment-color').value, status: $('#appointment-status').value,
        financialStatus: $('#financial-status').value
      });
    } else {
      const seriesId = uid();
      const frequency = kind === 'appointment' ? $('#appointment-recurrence').value : 'none';
      recurrenceDates(date, frequency).forEach(occurrence => state.appointments.push({
        id: uid(), seriesId, kind, date: isoDate(occurrence), start, end,
        label: $('#block-label').value.trim(), clientId: client?.id || null, clientName: client?.name || '',
        type: $('#appointment-type').value, modality: $('#appointment-modality').value,
        value: Number($('#appointment-value').value || 0), color: $('#appointment-color').value, recurrence: frequency,
        status: 'Agendado', financialStatus: 'A receber', createdAt: new Date().toISOString()
      }));
    }
    await saveState();
    $('#appointment-dialog').close();
    renderCalendar();
    showToast(id ? 'Atendimento atualizado.' : 'Atendimento salvo no dispositivo.');
  }

  function initials(name) { return name.split(/\s+/).slice(0,2).map(part => part[0]).join('').toUpperCase(); }

  function renderClients() {
    const query = $('#client-search').value.trim().toLocaleLowerCase();
    const clients = state.clients.filter(client => `${client.name} ${client.phone} ${client.notes || ''}`.toLocaleLowerCase().includes(query)).sort((a,b) => a.name.localeCompare(b.name));
    if (!clients.length) {
      $('#client-list').innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div><span class="empty-icon">♙</span><h3>${query ? 'Nenhum cliente encontrado' : 'Sua lista começa aqui'}</h3><p>${query ? 'Tente buscar por outro nome ou telefone.' : 'Cadastre um cliente ou crie um atendimento para adicioná-lo automaticamente.'}</p>${query ? '' : '<button class="primary-button" id="empty-new-client">Adicionar cliente</button>'}</div></div>`;
      $('#empty-new-client')?.addEventListener('click', () => openClientDialog());
      return;
    }
    $('#client-list').innerHTML = clients.map(client => `<button class="client-card" data-client-id="${client.id}" type="button"><span class="client-avatar client-${client.color || 'green'}">${escapeHTML(initials(client.name))}</span><span class="client-value">${formatMoney(client.defaultValue)}</span><h3>${escapeHTML(client.name)}</h3><p>${escapeHTML(client.phone || 'Telefone não informado')}</p></button>`).join('');
  }

  function openClientDialog(id = '') {
    $('#client-form').reset();
    $('#client-id').value = id;
    const client = state.clients.find(item => item.id === id);
    $('#client-dialog-title').textContent = client ? 'Editar cliente' : 'Novo cliente';
    $('#delete-client').classList.toggle('hidden', !client);
    $('#client-name').value = client?.name || '';
    $('#client-phone').value = client?.phone || '';
    $('#client-value').value = client?.defaultValue || 0;
    $('#client-notes').value = client?.notes || '';
    setSelectedColor('client', client?.color || 'green');
    $('#client-dialog').showModal();
  }

  async function submitClient(event) {
    event.preventDefault();
    const id = $('#client-id').value;
    const data = { name: $('#client-name').value.trim(), phone: $('#client-phone').value.trim(), defaultValue: Number($('#client-value').value || 0), notes: $('#client-notes').value.trim(), color: $('#client-color').value };
    if (id) Object.assign(state.clients.find(item => item.id === id), data);
    else state.clients.push({ id: uid(), ...data });
    await saveState();
    $('#client-dialog').close();
    renderClients();
    showToast(id ? 'Cliente atualizado.' : 'Cliente cadastrado.');
  }

  function confirmAction(title, text, actionLabel = 'Excluir') {
    return new Promise(resolve => {
      $('#confirm-title').textContent = title;
      $('#confirm-text').textContent = text;
      $('#confirm-action').textContent = actionLabel;
      const dialog = $('#confirm-dialog');
      const handler = () => { dialog.removeEventListener('close', handler); resolve(dialog.returnValue === 'confirm'); };
      dialog.addEventListener('close', handler);
      dialog.showModal();
    });
  }

  async function deleteAppointment() {
    const id = $('#appointment-id').value;
    if (!id || !await confirmAction('Excluir este item?', 'Essa ação remove apenas esta ocorrência da agenda.')) return;
    state.appointments = state.appointments.filter(item => item.id !== id);
    await saveState();
    $('#appointment-dialog').close(); renderCalendar(); showToast('Item excluído.');
  }

  async function rescheduleAppointment() {
    const id = $('#appointment-id').value;
    const original = state.appointments.find(item => item.id === id);
    if (!original) return;
    original.status = 'Remarcado';
    await saveState();
    const clone = { ...original };
    $('#appointment-dialog').close();
    resetAppointmentForm(clone.date, clone.start);
    $('#appointment-client').value = clone.clientName;
    $('#appointment-type').value = clone.type;
    $('#appointment-modality').value = clone.modality;
    $('#appointment-value').value = clone.value;
    $('#appointment-dialog').showModal();
    showToast('Escolha a nova data e salve.');
  }

  async function deleteClient() {
    const id = $('#client-id').value;
    const client = state.clients.find(item => item.id === id);
    if (!client || !await confirmAction('Excluir cliente?', 'Os atendimentos já registrados continuarão na agenda com o nome do cliente.')) return;
    state.clients = state.clients.filter(item => item.id !== id);
    await saveState(); $('#client-dialog').close(); renderClients(); showToast('Cliente excluído.');
  }

  function renderSummary() {
    const key = $('#summary-month').value || isoDate(new Date()).slice(0,7);
    $('#summary-month').value = key;
    const items = state.appointments.filter(item => item.kind === 'appointment' && item.date.startsWith(key) && item.status !== 'Cancelado' && item.status !== 'Remarcado');
    const sum = filter => items.filter(filter).reduce((total,item) => total + Number(item.value || 0), 0);
    const received = sum(item => item.financialStatus === 'Pago');
    const receivable = sum(item => item.financialStatus === 'A receber');
    const unpaid = sum(item => item.financialStatus === 'Não pago');
    const predicted = received + receivable;
    const cards = [
      ['Recebido',received,'var(--accent-strong)'],['A receber',receivable,'var(--amber)'],['Não pago',unpaid,'var(--red)'],['Total previsto',predicted,'var(--lilac)']
    ];
    $('#finance-cards').innerHTML = cards.map(([label,value,color]) => `<article class="finance-card" style="--card-color:${color}"><span>${label}</span><strong>${formatMoney(value)}</strong><i></i></article>`).join('');
    const monthDate = parseDate(`${key}-01`);
    $('#summary-list-title').textContent = `${items.length} atendimento${items.length === 1 ? '' : 's'} em ${months[monthDate.getMonth()]}`;
    if (!items.length) {
      $('#summary-list').innerHTML = '<div class="empty-state" style="min-height:260px"><div><span class="empty-icon">◔</span><h3>Nenhum movimento neste mês</h3><p>Os valores dos atendimentos aparecerão aqui conforme você agenda.</p></div></div>'; return;
    }
    $('#summary-list').innerHTML = items.sort((a,b) => a.date.localeCompare(b.date)).map(item => `<div class="summary-row"><strong>${escapeHTML(item.clientName)}</strong><span class="summary-date">${parseDate(item.date).toLocaleDateString('pt-BR',{day:'2-digit',month:'short'})} · ${item.start}</span><span class="status-chip ${item.financialStatus === 'Pago' ? 'paid' : item.financialStatus === 'Não pago' ? 'unpaid' : ''}">${item.financialStatus}</span><strong>${formatMoney(item.value)}</strong></div>`).join('');
  }

  function applyClientDefaultsToAppointment(event) {
    const client = state.clients.find(item => item.name.toLocaleLowerCase() === event.target.value.trim().toLocaleLowerCase());
    if (!client) return;
    if (Number($('#appointment-value').value) === 0) $('#appointment-value').value = client.defaultValue || 0;
  }

  function bindEvents() {
    $$('.bottom-nav button').forEach(button => button.addEventListener('click', () => setTab(button.dataset.tab)));
    $$('.segmented button').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
    $('#prev-date').addEventListener('click', () => navigateDate(-1));
    $('#next-date').addEventListener('click', () => navigateDate(1));
    $('#today-header').addEventListener('click', () => { anchorDate = new Date(); renderCalendar(); });
    $('#fab').addEventListener('click', () => openNewAppointment(isoDate(anchorDate), '09:00'));
    $('#calendar').addEventListener('click', event => {
      const eventButton = event.target.closest('[data-event-id]');
      if (eventButton) { event.stopPropagation(); openEditAppointment(eventButton.dataset.eventId); return; }
      const monthDay = event.target.closest('.month-day[data-date]');
      if (monthDay) { openNewAppointment(monthDay.dataset.date, '09:00'); return; }
      const hitArea = event.target.closest('.day-hit-area[data-date]');
      if (hitArea) {
        const rect = hitArea.getBoundingClientRect();
        const minute = Math.max(0, Math.min((HOURS_END-HOURS_START)*60-60, Math.round((event.clientY-rect.top)/15)*15));
        const total = HOURS_START*60 + minute;
        openNewAppointment(hitArea.dataset.date, `${pad(Math.floor(total/60))}:${pad(total%60)}`);
      }
    });
    $$('.type-toggle button').forEach(button => button.addEventListener('click', () => setAppointmentKind(button.dataset.kind)));
    $$('[data-color-picker] button').forEach(button => button.addEventListener('click', () => setSelectedColor(button.closest('[data-color-picker]').dataset.colorPicker, button.dataset.color)));
    $('#appointment-form').addEventListener('submit', submitAppointment);
    $('#appointment-client').addEventListener('input', applyClientDefaultsToAppointment);
    $('#appointment-client').addEventListener('change', applyClientDefaultsToAppointment);
    $('#appointment-start').addEventListener('input', updateEndFromStart);
    $('#appointment-start').addEventListener('change', updateEndFromStart);
    $('#delete-appointment').addEventListener('click', deleteAppointment);
    $('#reschedule-appointment').addEventListener('click', rescheduleAppointment);
    $('#new-client').addEventListener('click', () => openClientDialog());
    $('#client-form').addEventListener('submit', submitClient);
    $('#client-list').addEventListener('click', event => { const card = event.target.closest('[data-client-id]'); if (card) openClientDialog(card.dataset.clientId); });
    $('#client-search').addEventListener('input', renderClients);
    $('#delete-client').addEventListener('click', deleteClient);
    $('#summary-month').addEventListener('change', renderSummary);
    $$('[data-close]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.close).close()));
    window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstall = event; $('#install-button').classList.remove('hidden'); });
    $('#install-button').addEventListener('click', async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; $('#install-button').classList.add('hidden'); });
    window.addEventListener('appinstalled', () => showToast('Agenda instalada com sucesso.'));
  }

  async function init() {
    await loadState();
    anchorDate.setHours(0,0,0,0);
    bindEvents();
    setView(state.settings.view || 'week');
    setTab('agenda');
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  init();
})();

