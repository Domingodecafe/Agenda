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
  let suppressCalendarClickUntil = 0;
  let summaryClient = null;
  let summaryVisibleCount = 10;
  let appointmentDateTap = null;
  const paymentSelection = new Set();

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
    const enteringSummary = tab === 'summary' && activeTab !== 'summary';
    activeTab = tab;
    $$('.screen').forEach(screen => screen.classList.toggle('active', screen.id === `${tab}-screen`));
    $$('.bottom-nav button').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
    $('#fab').classList.toggle('hidden', tab !== 'agenda');
    $('#today-header').classList.toggle('hidden', tab !== 'agenda');
    if (tab === 'clients') renderClients();
    if (tab === 'summary') {
      if (enteringSummary) summaryVisibleCount = 10;
      renderSummary();
    }
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
    return `event-${eventColor(item)}`;
  }

  function eventColor(item) {
    if (item.kind === 'block') return 'neutral';
    const client = state.clients.find(entry => entry.id === item.clientId);
    return item.color || client?.color || ['green', 'purple', 'yellow'][hashColor(item.clientName)];
  }

  function appointmentDisplayName(item) {
    if (item.kind === 'block') return item.label || 'Horário bloqueado';
    return item.clientName || (item.type === 'Outro' ? 'Compromisso particular' : 'Atendimento');
  }

  function eventCard(item) {
    const start = Math.max(timeMinutes(item.start), HOURS_START * 60);
    const end = Math.min(timeMinutes(item.end), HOURS_END * 60);
    if (end <= HOURS_START * 60 || start >= HOURS_END * 60) return '';
    const top = 68 + start - HOURS_START * 60;
    const height = Math.max(26, end - start - 2);
    const title = appointmentDisplayName(item);
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
    positionMobileWeek();
  }

  function positionMobileWeek() {
    if (!window.matchMedia('(max-width: 640px)').matches) return;
    requestAnimationFrame(() => {
      const calendar = $('#calendar');
      calendar.style.removeProperty('--mobile-day-width');
      calendar.scrollLeft = 0;
    });
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
        ${events.slice(0,3).map(item => `<button class="month-event event-${eventColor(item)} ${item.financialStatus === 'Pago' ? 'paid' : ''}" data-event-id="${item.id}" type="button">${escapeHTML(item.start)} · ${escapeHTML(appointmentDisplayName(item))}</button>`).join('')}
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

  function bindCalendarSwipe() {
    const calendar = $('#calendar');
    let startX = 0;
    let startY = 0;
    let deltaX = 0;
    let horizontalGesture = false;
    let movingView = null;

    const resetMovingView = () => {
      if (!movingView) return;
      movingView.style.transition = 'transform .2s var(--ease-out), opacity .2s ease';
      movingView.style.transform = '';
      movingView.style.opacity = '';
      movingView = null;
    };

    calendar.addEventListener('touchstart', event => {
      if (event.touches.length !== 1) return;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
      deltaX = 0;
      horizontalGesture = false;
      movingView = calendar.firstElementChild;
    }, { passive: true });

    calendar.addEventListener('touchmove', event => {
      if (event.touches.length !== 1 || !movingView) return;
      deltaX = event.touches[0].clientX - startX;
      const deltaY = event.touches[0].clientY - startY;
      if (!horizontalGesture && Math.abs(deltaX) < Math.abs(deltaY) + 8) return;
      horizontalGesture = true;
      event.preventDefault();
      movingView.style.transition = 'none';
      movingView.style.transform = `translateX(${deltaX * .72}px)`;
      movingView.style.opacity = String(Math.max(.72, 1 - Math.abs(deltaX) / 600));
    }, { passive: false });

    const finishSwipe = () => {
      if (!movingView) return;
      if (horizontalGesture && Math.abs(deltaX) >= 48) {
        const direction = deltaX < 0 ? 1 : -1;
        const departingView = movingView;
        suppressCalendarClickUntil = Date.now() + 500;
        departingView.style.transition = 'transform .16s ease, opacity .16s ease';
        departingView.style.transform = `translateX(${direction > 0 ? '-24%' : '24%'})`;
        departingView.style.opacity = '.2';
        movingView = null;
        setTimeout(() => navigateDate(direction), 140);
      } else resetMovingView();
      horizontalGesture = false;
      deltaX = 0;
    };

    calendar.addEventListener('touchend', finishSwipe, { passive: true });
    calendar.addEventListener('touchcancel', resetMovingView, { passive: true });
  }

  function populateClientOptions() {
    $('#client-options').innerHTML = state.clients.sort((a,b) => a.name.localeCompare(b.name)).map(client => `<option value="${escapeHTML(client.name)}"></option>`).join('');
  }

  function populateTimeOptions() {
    const times = [];
    for (let total = 0; total < 24 * 60; total += 15) times.push(`${pad(Math.floor(total / 60))}:${pad(total % 60)}`);
    times.push('23:59');
    const options = times.map(time => `<option value="${time}">${time}</option>`).join('');
    $('#appointment-start').innerHTML = options;
    $('#appointment-end').innerHTML = options;
  }

  function setTimeValue(selector, value) {
    const select = $(selector);
    if (value && !Array.from(select.options).some(option => option.value === value)) select.add(new Option(value, value));
    select.value = value;
  }

  function oneHourAfter(start) {
    if (!start) return '';
    const total = Math.min(timeMinutes(start) + 60, (24 * 60) - 1);
    return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
  }

  function updateEndFromStart() {
    const calculatedEnd = oneHourAfter($('#appointment-start').value);
    if (calculatedEnd) setTimeValue('#appointment-end', calculatedEnd);
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
    setTimeValue('#appointment-start', start);
    setTimeValue('#appointment-end', oneHourAfter(start));
    $('#appointment-value').value = '0';
    setSelectedColor('appointment', 'green');
    $('#appointment-title').textContent = 'Novo atendimento';
    $('#appointment-kicker').textContent = 'NOVO';
    $('#edit-financial-field').classList.add('hidden');
    $('#delete-appointment').classList.add('hidden');
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
    $('#appointment-recurrence').disabled = kind !== 'appointment';
    $('#appointment-title').textContent = $('#appointment-id').value ? (kind === 'block' ? 'Editar bloqueio' : 'Editar atendimento') : (kind === 'block' ? 'Novo bloqueio' : 'Novo atendimento');
    updateAppointmentTypeFinanceState();
  }

  function updateAppointmentTypeFinanceState({ restorePaidValue = false } = {}) {
    const isAppointment = $('#appointment-kind').value === 'appointment';
    const isFree = isAppointment && $('#appointment-type').value === 'Outro';
    const clientInput = $('#appointment-client');
    const valueInput = $('#appointment-value');
    clientInput.required = isAppointment && !isFree;
    $('#appointment-client-label').textContent = isFree ? 'Cliente (opcional)' : 'Cliente';
    valueInput.readOnly = isFree;
    $('#appointment-value-field').classList.toggle('is-free', isFree);
    if (isFree) {
      valueInput.value = '0';
    } else if (isAppointment && restorePaidValue) {
      const clientName = clientInput.value.trim().toLocaleLowerCase();
      const client = state.clients.find(item => item.name.toLocaleLowerCase() === clientName);
      valueInput.value = client?.defaultValue || 0;
    }
    const canShowFinancialStatus = isAppointment && !isFree && Boolean($('#appointment-id').value);
    $('#edit-financial-field').classList.toggle('hidden', !canShowFinancialStatus);
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
    setTimeValue('#appointment-start', item.start);
    setTimeValue('#appointment-end', item.end);
    $('#appointment-value').value = item.value || 0;
    setSelectedColor('appointment', item.color || eventColor(item));
    $('#financial-status').value = item.financialStatus || 'A receber';
    $('#block-label').value = item.label || '';
    $('#appointment-title').textContent = item.kind === 'block' ? 'Editar bloqueio' : 'Editar atendimento';
    $('#appointment-kicker').textContent = 'DETALHES';
    $('#edit-financial-field').classList.toggle('hidden', item.kind === 'block');
    $('#delete-appointment').classList.remove('hidden');
    $('#appointment-recurrence').value = item.kind === 'appointment' ? item.recurrence || 'none' : 'none';
    $('#appointment-recurrence').disabled = item.kind !== 'appointment';
    setAppointmentKind(item.kind);
    updateAppointmentTypeFinanceState();
    $('#appointment-dialog').showModal();
  }

  function recurrenceDates(date, frequency, requestedCount = null) {
    const result = [parseDate(date)];
    if (frequency === 'none') return result;
    const count = requestedCount ?? (frequency === 'weekly' ? 52 : frequency === 'biweekly' ? 26 : 12);
    for (let index = 1; index < count; index += 1) {
      result.push(frequency === 'monthly' ? addMonths(result[0], index) : addDays(result[0], index * (frequency === 'biweekly' ? 14 : 7)));
    }
    return result;
  }

  function isRecurringItem(item) {
    return Boolean(item?.seriesId && (item.recurrence || 'none') !== 'none');
  }

  function seriesOccurrencesFrom(item) {
    return state.appointments
      .filter(entry => entry.id === item.id || (item.seriesId && entry.seriesId === item.seriesId && entry.date >= item.date))
      .sort((a, b) => {
        if (a.id === item.id) return -1;
        if (b.id === item.id) return 1;
        return `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`);
      });
  }

  function chooseSeriesScope({ title, text, singleLabel = 'Somente esta', futureLabel = 'Esta e futuras', allowSingle = true, danger = false }) {
    return new Promise(resolve => {
      $('#scope-title').textContent = title;
      $('#scope-text').textContent = text;
      $('#scope-single').textContent = singleLabel;
      $('#scope-single').classList.toggle('hidden', !allowSingle);
      const futureButton = $('#scope-future');
      futureButton.textContent = futureLabel;
      futureButton.className = danger ? 'danger-button' : 'primary-button';
      const dialog = $('#scope-dialog');
      dialog.returnValue = 'cancel';
      const handler = () => {
        dialog.removeEventListener('close', handler);
        resolve(dialog.returnValue || 'cancel');
      };
      dialog.addEventListener('close', handler);
      dialog.showModal();
    });
  }

  async function submitAppointment(event) {
    event.preventDefault();
    const id = $('#appointment-id').value;
    const kind = $('#appointment-kind').value;
    const appointmentType = $('#appointment-type').value;
    const isFreeAppointment = kind === 'appointment' && appointmentType === 'Outro';
    const date = $('#appointment-date').value;
    const start = $('#appointment-start').value;
    const end = $('#appointment-end').value;
    if (!date || !start || !end || timeMinutes(end) <= timeMinutes(start)) {
      $('#form-error').textContent = 'Confira a data e informe um horário final posterior ao inicial.'; return;
    }
    if (kind === 'appointment' && !isFreeAppointment && !$('#appointment-client').value.trim()) {
      $('#form-error').textContent = 'Informe o nome do cliente.'; return;
    }
    const existingItem = id ? state.appointments.find(entry => entry.id === id) : null;
    if (id && !existingItem) return;
    const previousFrequency = existingItem?.recurrence || 'none';
    const frequency = kind === 'appointment' ? $('#appointment-recurrence').value : 'none';
    const recurrenceChanged = Boolean(existingItem && previousFrequency !== frequency);
    let editScope = 'single';
    if (existingItem && recurrenceChanged) {
      editScope = await chooseSeriesScope({
        title: 'Alterar recorrência?',
        text: 'A nova recorrência será aplicada a esta sessão e a todas as próximas. As sessões anteriores serão preservadas.',
        futureLabel: 'Aplicar a esta e futuras',
        allowSingle: false
      });
    } else if (isRecurringItem(existingItem)) {
      editScope = await chooseSeriesScope({
        title: 'Aplicar alterações',
        text: 'Deseja alterar somente esta sessão ou esta e todas as próximas da sequência?',
        singleLabel: 'Alterar somente esta',
        futureLabel: 'Alterar esta e futuras'
      });
    }
    if (editScope === 'cancel') return;

    let client = null;
    if (kind === 'appointment' && $('#appointment-client').value.trim()) {
      const clientName = $('#appointment-client').value.trim();
      client = state.clients.find(item => item.name.toLocaleLowerCase() === clientName.toLocaleLowerCase());
      if (!client) {
        client = { id: uid(), name: clientName, phone: '', defaultValue: Number($('#appointment-value').value || 0), notes: '', color: $('#appointment-color').value };
        state.clients.push(client);
      }
    }
    const formData = {
      kind, date, start, end,
      label: $('#block-label').value.trim(),
      clientId: client?.id || null, clientName: client?.name || '',
      type: appointmentType, modality: $('#appointment-modality').value,
      value: isFreeAppointment ? 0 : Number($('#appointment-value').value || 0), color: $('#appointment-color').value,
      financialStatus: isFreeAppointment ? (existingItem?.financialStatus || 'A receber') : $('#financial-status').value
    };

    if (existingItem) {
      if (editScope === 'single') {
        Object.assign(existingItem, formData, { recurrence: previousFrequency, seriesId: existingItem.seriesId || null });
      } else {
        const originalDate = existingItem.date;
        const affected = seriesOccurrencesFrom(existingItem);
        const targetCount = frequency === 'none' ? 1 : previousFrequency === 'none' ? recurrenceDates(date, frequency).length : affected.length;
        const scheduleChanged = originalDate !== date || previousFrequency !== frequency;
        const dates = scheduleChanged
          ? recurrenceDates(date, frequency, targetCount).map(isoDate)
          : affected.slice(0, targetCount).map(entry => entry.date);
        const hasPast = Boolean(existingItem.seriesId && state.appointments.some(entry => entry.seriesId === existingItem.seriesId && entry.date < originalDate));
        const nextSeriesId = frequency === 'none' ? null : recurrenceChanged && hasPast ? uid() : existingItem.seriesId || uid();
        const removedIds = new Set(affected.slice(targetCount).map(entry => entry.id));
        if (removedIds.size) state.appointments = state.appointments.filter(entry => !removedIds.has(entry.id));
        for (let index = 0; index < targetCount; index += 1) {
          const target = affected[index] || { id: uid(), createdAt: new Date().toISOString() };
          Object.assign(target, formData, { date: dates[index], recurrence: frequency, seriesId: nextSeriesId });
          target.status ||= 'Agendado';
          if (!state.appointments.some(entry => entry.id === target.id)) state.appointments.push(target);
        }
      }
    } else {
      const seriesId = frequency === 'none' ? null : uid();
      recurrenceDates(date, frequency).forEach(occurrence => state.appointments.push({
        ...formData, id: uid(), seriesId, date: isoDate(occurrence), recurrence: frequency,
        status: 'Agendado', financialStatus: 'A receber', createdAt: new Date().toISOString()
      }));
    }
    await saveState();
    $('#appointment-dialog').close();
    renderCalendar();
    showToast(editScope === 'future' ? 'Esta sessão e as próximas foram atualizadas.' : id ? 'Atendimento atualizado.' : 'Atendimento salvo no dispositivo.');
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

  function confirmAction(title, text, actionLabel = 'Excluir', tone = 'danger') {
    return new Promise(resolve => {
      $('#confirm-title').textContent = title;
      $('#confirm-text').textContent = text;
      $('#confirm-action').textContent = actionLabel;
      $('#confirm-action').className = tone === 'primary' ? 'primary-button' : 'danger-button';
      const dialog = $('#confirm-dialog');
      dialog.returnValue = 'cancel';
      const handler = () => { dialog.removeEventListener('close', handler); resolve(dialog.returnValue === 'confirm'); };
      dialog.addEventListener('close', handler);
      dialog.showModal();
    });
  }

  async function deleteAppointment() {
    const id = $('#appointment-id').value;
    const item = state.appointments.find(entry => entry.id === id);
    if (!item) return;
    let scope = 'single';
    if (isRecurringItem(item)) {
      scope = await chooseSeriesScope({
        title: 'Excluir atendimento recorrente?',
        text: 'Escolha se deseja remover somente esta sessão ou esta e todas as próximas. As sessões anteriores serão preservadas.',
        singleLabel: 'Excluir somente esta',
        futureLabel: 'Excluir esta e futuras',
        danger: true
      });
      if (scope === 'cancel') return;
    } else if (!await confirmAction('Excluir este item?', 'Essa ação remove apenas esta ocorrência da agenda.')) return;
    state.appointments = scope === 'future'
      ? state.appointments.filter(entry => entry.seriesId !== item.seriesId || entry.date < item.date)
      : state.appointments.filter(entry => entry.id !== id);
    await saveState();
    $('#appointment-dialog').close(); renderCalendar(); showToast(scope === 'future' ? 'Esta sessão e as próximas foram excluídas.' : 'Item excluído.');
  }

  async function deleteClient() {
    const id = $('#client-id').value;
    const client = state.clients.find(item => item.id === id);
    if (!client || !await confirmAction('Excluir cliente?', 'Os atendimentos já registrados continuarão na agenda com o nome do cliente.')) return;
    state.clients = state.clients.filter(item => item.id !== id);
    await saveState(); $('#client-dialog').close(); renderClients(); showToast('Cliente excluído.');
  }

  const normalizeClientName = name => String(name || '').trim().toLocaleLowerCase();

  function clientMatchesAppointment(client, appointment) {
    return Boolean(client && ((client.id && appointment.clientId === client.id) || normalizeClientName(appointment.clientName) === normalizeClientName(client.name)));
  }

  function appointmentEnd(appointment) {
    const date = parseDate(appointment.date);
    const minutes = timeMinutes(appointment.end || appointment.start || '00:00');
    date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    return date;
  }

  function summaryStatus(items) {
    const paid = items.filter(item => item.financialStatus === 'Pago').length;
    if (paid === items.length) return ['Pago', 'paid'];
    if (paid === 0) return ['Pendente', 'unpaid'];
    return ['Parcial', 'partial'];
  }

  function summaryClientKey(item) {
    const registered = state.clients.find(client => client.id === item.clientId) || state.clients.find(client => normalizeClientName(client.name) === normalizeClientName(item.clientName));
    return registered ? `id:${registered.id}` : `name:${normalizeClientName(item.clientName)}`;
  }

  function renderSummary() {
    summaryClient = null;
    paymentSelection.clear();
    $('#summary-overview').classList.remove('hidden');
    $('#client-finance-detail').classList.add('hidden');
    const key = $('#summary-month').value || isoDate(new Date()).slice(0,7);
    $('#summary-month').value = key;
    const items = state.appointments.filter(item => item.kind === 'appointment' && item.type !== 'Outro' && item.date.startsWith(key));
    const sum = filter => items.filter(filter).reduce((total,item) => total + Number(item.value || 0), 0);
    const received = sum(item => item.financialStatus === 'Pago');
    const receivable = sum(item => item.financialStatus === 'A receber');
    const predicted = received + receivable;
    const cards = [
      ['Recebido',received,'var(--accent-strong)'],['A receber',receivable,'var(--amber)'],['Total previsto',predicted,'var(--lilac)']
    ];
    $('#finance-cards').innerHTML = cards.map(([label,value,color]) => `<article class="finance-card" style="--card-color:${color}"><span>${label}</span><strong>${formatMoney(value)}</strong><i></i></article>`).join('');
    const monthDate = parseDate(`${key}-01`);
    const groups = new Map();
    items.forEach(item => {
      const key = summaryClientKey(item);
      if (!groups.has(key)) groups.set(key, { key, id: item.clientId || '', name: item.clientName, items: [] });
      groups.get(key).items.push(item);
    });
    const statusPriority = { Pendente: 0, Parcial: 1, Pago: 2 };
    const clients = [...groups.values()].map(group => {
      const [status, statusClass] = summaryStatus(group.items);
      return { ...group, status, statusClass };
    }).sort((a,b) => statusPriority[a.status] - statusPriority[b.status] || a.name.localeCompare(b.name, 'pt-BR'));
    $('#summary-list-title').textContent = `${clients.length} cliente${clients.length === 1 ? '' : 's'} em ${months[monthDate.getMonth()]}`;
    if (!items.length) {
      $('#summary-list').innerHTML = '<div class="empty-state" style="min-height:260px"><div><span class="empty-icon">◔</span><h3>Nenhum movimento neste mês</h3><p>Os valores dos atendimentos aparecerão aqui conforme você agenda.</p></div></div>'; return;
    }
    const visibleClients = clients.slice(0, summaryVisibleCount);
    const remaining = Math.max(0, clients.length - visibleClients.length);
    $('#summary-list').innerHTML = visibleClients.map(group => {
      const total = group.items.reduce((sum,item) => sum + Number(item.value || 0), 0);
      return `<button class="summary-row summary-client-row" data-summary-client="${escapeHTML(group.key)}" type="button"><span class="summary-client-name"><strong>${escapeHTML(group.name)}</strong><small>${group.items.length} atendimento${group.items.length === 1 ? '' : 's'}</small></span><span class="status-chip ${group.statusClass}">${group.status}</span><strong>${formatMoney(total)}</strong><span class="row-arrow">›</span></button>`;
    }).join('') + (remaining ? `<div class="summary-more-wrap"><button class="summary-more-button" data-summary-more type="button">Mostrar mais 10 <span>${remaining} restante${remaining === 1 ? '' : 's'}</span></button></div>` : '');
  }

  function selectedClientAppointments() {
    return state.appointments.filter(item => item.kind === 'appointment' && item.type !== 'Outro' && clientMatchesAppointment(summaryClient, item));
  }

  function financeAppointmentRow(item, isPast) {
    const checked = paymentSelection.has(item.id);
    const date = parseDate(item.date).toLocaleDateString('pt-BR', { weekday:'short', day:'2-digit', month:'short', year:'numeric' });
    const statusClass = item.financialStatus === 'Pago' ? 'paid' : item.financialStatus === 'Não pago' ? 'unpaid' : '';
    return `<div class="finance-appointment-row selectable">
      <span class="payment-check"><input type="checkbox" data-payment-id="${item.id}" ${checked ? 'checked' : ''} aria-label="Selecionar atendimento de ${escapeHTML(date)}"></span>
      <button class="appointment-date appointment-date-button" data-appointment-date-id="${item.id}" type="button" aria-label="Selecionar ${escapeHTML(date)}; toque duas vezes para abrir o atendimento na Agenda"><strong>${escapeHTML(date)}</strong><small>${escapeHTML(item.start)}–${escapeHTML(item.end)}</small></button>
      <span class="status-chip ${statusClass}">${escapeHTML(item.financialStatus || 'A receber')}</span>
      <strong class="appointment-value">${formatMoney(item.value)}</strong>
    </div>`;
  }

  function renderClientFinanceDetail() {
    if (!summaryClient) return renderSummary();
    const now = new Date();
    const appointments = selectedClientAppointments();
    const past = appointments.filter(item => appointmentEnd(item) < now).sort((a,b) => appointmentEnd(b) - appointmentEnd(a));
    const future = appointments.filter(item => appointmentEnd(item) >= now).sort((a,b) => appointmentEnd(a) - appointmentEnd(b));
    const validIds = new Set(appointments.map(item => item.id));
    [...paymentSelection].forEach(id => { if (!validIds.has(id)) paymentSelection.delete(id); });
    $('#detail-client-name').textContent = summaryClient.name;
    $('#detail-client-subtitle').textContent = `${appointments.length} atendimento${appointments.length === 1 ? '' : 's'} no histórico completo`;
    $('#past-count').textContent = `${past.length} ${past.length === 1 ? 'sessão' : 'sessões'}`;
    $('#future-count').textContent = `${future.length} ${future.length === 1 ? 'sessão' : 'sessões'}`;
    $('#past-appointments').innerHTML = past.length ? past.map(item => financeAppointmentRow(item, true)).join('') : '<p class="section-empty">Nenhum atendimento passado.</p>';
    $('#future-appointments').innerHTML = future.length ? future.map(item => financeAppointmentRow(item, false)).join('') : '<p class="section-empty">Nenhum atendimento futuro.</p>';
    updatePaymentBar();
  }

  function openClientFinanceDetail(key) {
    const monthItems = state.appointments.filter(item => item.kind === 'appointment' && item.type !== 'Outro' && summaryClientKey(item) === key);
    const sample = monthItems[0];
    if (!sample) return;
    summaryClient = { id: sample.clientId || '', name: sample.clientName };
    paymentSelection.clear();
    $('#summary-overview').classList.add('hidden');
    $('#client-finance-detail').classList.remove('hidden');
    renderClientFinanceDetail();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updatePaymentBar() {
    const selected = state.appointments.filter(item => paymentSelection.has(item.id));
    const total = selected.reduce((sum,item) => sum + Number(item.value || 0), 0);
    $('#payment-selection-count').textContent = `${selected.length} selecionado${selected.length === 1 ? '' : 's'}`;
    $('#payment-selection-total').textContent = formatMoney(total);
    $('#payment-bar').classList.toggle('hidden', !selected.length);
    $('#clear-payment-selection').classList.toggle('hidden', !selected.length);
  }

  function togglePaymentSelection(id) {
    if (paymentSelection.has(id)) paymentSelection.delete(id);
    else paymentSelection.add(id);
    renderClientFinanceDetail();
  }

  function openAppointmentFromSummary(id) {
    const item = state.appointments.find(entry => entry.id === id);
    if (!item) return;
    anchorDate = parseDate(item.date);
    setView('day');
    setTab('agenda');
    openEditAppointment(id);
  }

  function handleAppointmentDateTap(id) {
    const now = Date.now();
    if (appointmentDateTap?.id === id && now - appointmentDateTap.startedAt <= 360) {
      clearTimeout(appointmentDateTap.timer);
      appointmentDateTap = null;
      openAppointmentFromSummary(id);
      return;
    }
    if (appointmentDateTap) {
      clearTimeout(appointmentDateTap.timer);
      togglePaymentSelection(appointmentDateTap.id);
    }
    const pendingTap = { id, startedAt: now, timer: null };
    pendingTap.timer = setTimeout(() => {
      if (appointmentDateTap !== pendingTap) return;
      appointmentDateTap = null;
      togglePaymentSelection(id);
    }, 360);
    appointmentDateTap = pendingTap;
  }

  async function applyFinancialStatus(status) {
    const selected = state.appointments.filter(item => paymentSelection.has(item.id));
    if (!selected.length) return;
    const total = selected.reduce((sum,item) => sum + Number(item.value || 0), 0);
    const descriptions = {
      'Pago': ['Confirmar recebimento?', 'marcado como pago', 'marcados como pagos', 'Confirmar pagamento'],
      'A receber': ['Alterar para A receber?', 'marcado como A receber', 'marcados como A receber', 'Confirmar alteração'],
      'Não pago': ['Alterar para Não pago?', 'marcado como não pago', 'marcados como não pagos', 'Confirmar alteração']
    };
    const [title, singularAction, pluralAction, buttonText] = descriptions[status] || descriptions['A receber'];
    const confirmed = await confirmAction(title, `${selected.length} atendimento${selected.length === 1 ? '' : 's'} ${selected.length === 1 ? 'será' : 'serão'} ${selected.length === 1 ? singularAction : pluralAction}, totalizando ${formatMoney(total)}.`, buttonText, status === 'Não pago' ? 'danger' : 'primary');
    if (!confirmed) return;
    selected.forEach(item => { item.financialStatus = status; });
    await saveState();
    const currentClient = { ...summaryClient };
    paymentSelection.clear();
    renderSummary();
    summaryClient = currentClient;
    $('#summary-overview').classList.add('hidden');
    $('#client-finance-detail').classList.remove('hidden');
    renderClientFinanceDetail();
    showToast(`${selected.length} atendimento${selected.length === 1 ? '' : 's'} alterado${selected.length === 1 ? '' : 's'} para ${status}.`);
  }

  function applyClientDefaultsToAppointment(event) {
    if ($('#appointment-type').value === 'Outro') return;
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
    $('#today-toolbar').addEventListener('click', () => { anchorDate = new Date(); renderCalendar(); });
    $('#fab').addEventListener('click', () => openNewAppointment(isoDate(anchorDate), '09:00'));
    $('#calendar').addEventListener('click', event => {
      if (Date.now() < suppressCalendarClickUntil) { event.preventDefault(); return; }
      const eventButton = event.target.closest('[data-event-id]');
      if (eventButton) { event.stopPropagation(); openEditAppointment(eventButton.dataset.eventId); return; }
      const monthDay = event.target.closest('.month-day[data-date]');
      if (monthDay) { openNewAppointment(monthDay.dataset.date, '09:00'); return; }
      const hitArea = event.target.closest('.day-hit-area[data-date]');
      if (hitArea) {
        const rect = hitArea.getBoundingClientRect();
        const hourOffset = Math.max(0, Math.min(HOURS_END - HOURS_START - 1, Math.floor((event.clientY - rect.top) / 60)));
        const total = (HOURS_START + hourOffset) * 60;
        openNewAppointment(hitArea.dataset.date, `${pad(Math.floor(total/60))}:${pad(total%60)}`);
      }
    });
    $$('.type-toggle button').forEach(button => button.addEventListener('click', () => setAppointmentKind(button.dataset.kind)));
    $$('[data-color-picker] button').forEach(button => button.addEventListener('click', () => setSelectedColor(button.closest('[data-color-picker]').dataset.colorPicker, button.dataset.color)));
    $('#appointment-form').addEventListener('submit', submitAppointment);
    $('#appointment-type').addEventListener('change', () => updateAppointmentTypeFinanceState({ restorePaidValue: true }));
    $('#appointment-client').addEventListener('input', applyClientDefaultsToAppointment);
    $('#appointment-client').addEventListener('change', applyClientDefaultsToAppointment);
    $('#appointment-start').addEventListener('input', updateEndFromStart);
    $('#appointment-start').addEventListener('change', updateEndFromStart);
    $('#delete-appointment').addEventListener('click', deleteAppointment);
    $('#new-client').addEventListener('click', () => openClientDialog());
    $('#client-form').addEventListener('submit', submitClient);
    $('#client-list').addEventListener('click', event => { const card = event.target.closest('[data-client-id]'); if (card) openClientDialog(card.dataset.clientId); });
    $('#client-search').addEventListener('input', renderClients);
    $('#delete-client').addEventListener('click', deleteClient);
    $('#summary-month').addEventListener('change', () => { summaryVisibleCount = 10; renderSummary(); });
    $('#summary-list').addEventListener('click', event => {
      const moreButton = event.target.closest('[data-summary-more]');
      if (moreButton) { summaryVisibleCount += 10; renderSummary(); return; }
      const row = event.target.closest('[data-summary-client]');
      if (row) openClientFinanceDetail(row.dataset.summaryClient);
    });
    $('#summary-back').addEventListener('click', renderSummary);
    $('#clear-payment-selection').addEventListener('click', () => { paymentSelection.clear(); renderClientFinanceDetail(); });
    $$('[data-financial-action]').forEach(button => button.addEventListener('click', () => applyFinancialStatus(button.dataset.financialAction)));
    $('#client-finance-detail').addEventListener('change', event => {
      const checkbox = event.target.closest('[data-payment-id]');
      if (!checkbox) return;
      if (checkbox.checked) paymentSelection.add(checkbox.dataset.paymentId);
      else paymentSelection.delete(checkbox.dataset.paymentId);
      updatePaymentBar();
    });
    $('#client-finance-detail').addEventListener('click', event => {
      const dateButton = event.target.closest('[data-appointment-date-id]');
      if (!dateButton) return;
      event.preventDefault();
      handleAppointmentDateTap(dateButton.dataset.appointmentDateId);
    });
    window.addEventListener('resize', () => { if (state.settings.view === 'week') positionMobileWeek(); });
    $$('[data-close]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.close).close()));
    window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstall = event; $('#install-button').classList.remove('hidden'); });
    $('#install-button').addEventListener('click', async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; $('#install-button').classList.add('hidden'); });
    window.addEventListener('appinstalled', () => showToast('Agenda instalada com sucesso.'));
  }

  async function init() {
    await loadState();
    anchorDate.setHours(0,0,0,0);
    populateTimeOptions();
    bindEvents();
    bindCalendarSwipe();
    setView(state.settings.view || 'week');
    setTab('agenda');
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  init();
})();

