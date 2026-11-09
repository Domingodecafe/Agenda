(() => {
  'use strict';
  if (!globalThis.AnaEnvironment?.isAllowed()) return;
  const $ = id => document.getElementById(id);
  const money = n => (n / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const date = s => s ? s.split('-').reverse().join('/') : 'Sem data válida';
  if (AnaEnvironment.shared) {
    const template = $('shared-fin-template');
    document.body.classList.add('fin-shared');
    document.body.replaceChildren(template.content.cloneNode(true));
    const month = $('fin-month');
    const filter = $('fin-filter');
    const list = $('fin-records');
    const empty = $('fin-empty');
    const more = $('fin-more');
    const batchSize = 10;
    let visibleCount = batchSize;
    const retry = document.querySelector('.fin-retry');
    let current = null;
    let reading = false;
    month.value = FinCore.dateParts().date.slice(0, 7);

    function renderHistory() {
      if (!current || !month.value) return;
      const received = [];
      const open = [];
      for (const record of current.records) {
        if (record.status === 'Pago') {
          if ((record.paymentDate || record.sessionDate).startsWith(month.value)) received.push(record);
        } else if (!record.cancelled && record.sessionDate.startsWith(month.value)) {
          open.push(record);
        }
      }
      const total = entries => money(entries.reduce((sum, item) => sum + item.amountCents, 0));
      $('fin-received').textContent = total(received.filter(record => record.paymentDate));
      $('fin-open').textContent = total(open);
      const entries = filter.value === 'received' ? received : filter.value === 'open' ? open : [...received, ...open];
      const day = record => record.paymentDate || record.sessionDate;
      entries.sort((a, b) => day(b).localeCompare(day(a)) || a.endTime.localeCompare(b.endTime));
      more.hidden = entries.length <= visibleCount;
      const rows = entries.slice(0, visibleCount).map(record => {
        const paid = record.status === 'Pago';
        const item = document.createElement('li');
        const who = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = current.names.get(record.appointmentId) || 'Cliente não identificado';
        const when = document.createElement('small');
        when.textContent = paid && record.paymentDate ? 'Pagamento em ' + date(record.paymentDate) :
          'Atendimento em ' + date(record.sessionDate);
        who.append(name, when);
        const amount = document.createElement('div');
        const value = document.createElement('strong');
        value.textContent = money(record.amountCents);
        const state = document.createElement('small');
        state.textContent = paid ? record.paymentDate ? 'Recebido' : 'Pago · sem data' : 'Em aberto';
        amount.append(value, state);
        item.append(who, amount);
        return item;
      });
      list.replaceChildren(...rows);
      empty.hidden = rows.length > 0;
      empty.textContent = 'Nenhuma movimentação para este filtro.';
    }

    async function update() {
      if (reading) return;
      reading = true;
      retry.querySelector('button').disabled = true;
      try {
        current = await FinStore.agenda({ withNames: true });
        renderHistory();
        retry.hidden = true;
      } catch {
        retry.hidden = false;
        if (!current) empty.hidden = true;
      } finally {
        reading = false;
        retry.querySelector('button').disabled = false;
      }
    }
    function resetHistory() {
      visibleCount = batchSize;
      renderHistory();
    }
    filter.addEventListener('change', resetHistory);
    month.addEventListener('change', resetHistory);
    more.addEventListener('click', () => {
      const firstNewRecord = visibleCount;
      visibleCount += batchSize;
      renderHistory();
      const record = list.children[firstNewRecord];
      if (record) {
        record.tabIndex = -1;
        record.focus();
      }
    });
    retry.querySelector('button').addEventListener('click', update);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void update(); });
    setInterval(() => { if (!document.hidden) void update(); }, 60000);
    void update();
    return;
  }

  let snapshot, ledger, report, reading = null, mutation = false, draft = false;
  let requestId = crypto.randomUUID(), lastIntent = 'result', payRequest = null, restoreCandidate = null;
  const today = () => FinCore.dateParts().date;
  $('month').value = today().slice(0, 7); $('expense-date').value = today(); $('pay-date').max = today();
  function status(message, error = false) { $('status').textContent = message; $('status').dataset.error = error; }
  function cell(row, content) { const el = document.createElement('td'); el.textContent = content; row.append(el); return el; }
  function button(parent, label, action) { const b = document.createElement('button'); b.type = 'button'; b.className = 'secondary'; b.textContent = label; b.onclick = action; parent.append(b); return b; }
  function download(value, filename) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function setCategories() {
    const current = $('category').value;
    $('category').replaceChildren();
    for (const name of ledger.settings.categories) { const option = document.createElement('option'); option.value = name; option.textContent = name; $('category').append(option); }
    $('category').value = ledger.settings.categories.includes(current) ? current : ledger.settings.categories.includes('Outros') ? 'Outros' : ledger.settings.categories[0];
    if (document.activeElement !== $('categories')) $('categories').value = ledger.settings.categories.join('\n');
  }
  function updateEntry() {
    const paid = $('entry-kind').value === 'paid';
    $('date-label').textContent = paid ? 'Data do pagamento' : $('entry-kind').value === 'monthly' ? 'Primeiro vencimento (repete todo mês)' : 'Vencimento';
    $('expense-date').max = paid ? today() : '';
    $('save-expense').textContent = draft ? 'Confirmar rascunho' : paid ? 'Registrar despesa' : 'Cadastrar conta';
    $('cancel-draft').hidden = !draft;
  }
  function clearDraft() {
    draft = false; requestId = crypto.randomUUID(); $('description').value = ''; $('value').value = ''; $('expense-date').value = today(); $('entry-kind').value = 'paid';
    $('draft-status').textContent = 'Cadastre uma despesa paga ou planeje uma conta.'; updateEntry();
  }
  async function mutate(work) {
    if (mutation) throw new Error('Aguarde a operação em andamento.');
    mutation = true;
    try { return await work(); } finally { mutation = false; }
  }
  function render() {
    report = FinCore.forecast(snapshot, ledger, $('month').value);
    $('cards').replaceChildren();
    const cards = [['Recebidos no mês', report.receivedCents], ['Despesas pagas no mês', report.expenseCents], ['Resultado registrado', report.netCashCents], ['Entradas previstas', report.upcomingCents], ['Saídas previstas', report.plannedExpenseCents], [report.historical ? 'Resultado · mês encerrado' : 'Resultado estimado', report.historical ? report.netCashCents : report.projectedCents], ['Para receber · todos os meses', report.dueCents], ['Pagos sem data válida', report.undatedCents]];
    for (const [label, n] of cards) {
      const card = document.createElement('article'); card.className = 'card';
      const title = document.createElement('span'), amount = document.createElement('strong');
      title.textContent = label; amount.textContent = money(n); card.append(title, amount); $('cards').append(card);
    }
    $('insight').textContent = FinTools.execute({ intent: 'forecast', month: report.month }, snapshot, ledger).text;
    const labels = { invalid_amount: 'Valor inválido; sessão fora dos totais.', invalid_session_date: 'Data ou horário inválido; sessão fora dos totais.', unknown_financial_status: 'Status desconhecido; sessão fora dos totais.', paid_without_valid_date: 'Pago sem data válida; fora dos recebidos mensais.', cancelled_unpaid_review: 'Cancelamento sem pagamento: sem cobrança, fora das previsões.' };
    $('warnings').replaceChildren();
    for (const w of snapshot.warnings) { const li = document.createElement('li'); li.textContent = `${w.appointmentId}: ${labels[w.code] || w.code}`; $('warnings').append(li); }
    $('records').replaceChildren();
    for (const r of report[$('view').value]) {
      const row = document.createElement('tr');
      cell(row, `${r.appointmentId} / ${r.clientRef}`); cell(row, date(r.sessionDate));
      cell(row, r.status === 'Pago' ? `${date(r.paymentDate)} · ${r.paymentMethod || 'Forma não informada'}` : r.status);
      cell(row, money(r.amountCents)); $('records').append(row);
    }
    if (!$('records').children.length) { const row = document.createElement('tr'); cell(row, 'Nenhuma sessão nesta visão.').colSpan = 4; $('records').append(row); }
    $('expenses').replaceChildren();
    for (const e of report.expenses) {
      const row = document.createElement('tr'); cell(row, `${e.description} · ${e.category}`); cell(row, date(e.date)); cell(row, money(e.amountCents));
      button(cell(row, ''), 'Estornar', async () => {
        if (!confirm(`Estornar “${e.description}”, ${money(e.amountCents)}? O histórico será preservado.${e.occurrenceId ? ' A conta voltará a ficar aberta.' : ''}`)) return;
        try { await mutate(() => FinStore.voidExpense(e.id)); await refresh(); } catch (error) { status(error.message, true); }
      });
      $('expenses').append(row);
    }
    $('obligations').replaceChildren();
    for (const o of report.occurrences) {
      const row = document.createElement('tr'); cell(row, `${o.description} · ${o.category}`); cell(row, date(o.dueDate)); cell(row, money(o.amountCents));
      const actions = cell(row, ({ open: o.dueDate < today() ? 'Vencida ' : 'Aberta ', paid: 'Paga', cancelled: 'Cancelada' })[o.status]);
      if (o.status === 'open') {
        button(actions, 'Pagar', () => {
          payRequest = { occurrenceId: o.id, id: crypto.randomUUID() }; $('pay-description').textContent = `${o.description} · ${date(o.dueDate)} · ${money(o.amountCents)}`;
          $('pay-date').value = today(); $('pay-date').max = today(); $('pay-error').textContent = ''; $('pay-dialog').showModal();
        });
        button(actions, 'Cancelar ocorrência', async () => {
          if (!confirm(`Cancelar somente a ocorrência de ${date(o.dueDate)} de “${o.description}”?`)) return;
          try { await mutate(() => FinStore.cancelOccurrence(o.id)); await refresh(); } catch (error) { status(error.message, true); }
        });
      }
      $('obligations').append(row);
    }
    $('export').disabled = false;
  }
  async function refresh({ initial = false, useSettings = false } = {}) {
    $('export').disabled = true;
    const operation = (reading || Promise.resolve()).then(async () => {
      try {
        const values = await Promise.all([FinStore.agenda(), FinStore.read()]);
        [snapshot, ledger] = values;
        if (initial || useSettings) $('month').value = ledger.settings.selectedMonth;
        setCategories(); render();
        status(`Leitura local atualizada às ${new Date(snapshot.generatedAt).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })}, horário de São Paulo.`);
        return { snapshot, ledger };
      } catch (error) {
        snapshot = null; report = null;
        for (const name of ['cards', 'records', 'expenses', 'obligations', 'warnings']) $(name).replaceChildren();
        $('insight').textContent = 'Leitura indisponível. Atualize para consultar os valores.'; status(error.message, true);
        // Despesas e backups continuam acessíveis mesmo sem uma Agenda disponível.
        try { ledger = await FinStore.read(); setCategories(); } catch { ledger = null; }
        return null;
      }
    });
    reading = operation;
    try { return await operation; } finally { if (reading === operation) reading = null; }
  }
  function appendChat(author, message, answer = null) {
    const box = document.createElement('article'); box.className = author === 'Você' ? 'chat-message user' : 'chat-message';
    const title = document.createElement('strong'), body = document.createElement('p'); title.textContent = author; body.textContent = message; box.append(title, body);
    if (answer) {
      const meta = document.createElement('small'); meta.textContent = `Período: ${answer.month}. Fonte: Agenda Ana DEV + livro Fin; leitura ${new Date(answer.sourceAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. ${answer.limitations}`; box.append(meta);
      const details = document.createElement('details'), summary = document.createElement('summary'), refs = document.createElement('p'); summary.textContent = `Referências (${answer.references.length}) e alertas (${answer.warnings.length})`;
      refs.textContent = (answer.references.length ? answer.references.slice(0, 100).join(', ') + (answer.references.length > 100 ? '… Veja a exportação para a lista completa.' : '') : 'Sem registros associados a esta resposta.') + (answer.warnings.length ? '\nAlertas: ' + answer.warnings.map(w => `${w.appointmentId}: ${w.code}`).join('; ') : ''); details.append(summary, refs); box.append(details);
    }
    $('chat-log').append(box);
    while ($('chat-log').children.length > 40) $('chat-log').firstChild.remove();
    $('chat-log').scrollTop = $('chat-log').scrollHeight;
  }
  async function ask(message) {
    $('chat-send').disabled = true; appendChat('Você', message);
    try {
      const source = await refresh(); if (!source) throw new Error('Não foi possível ler os registros atuais; nenhuma consulta ou lançamento foi executado.');
      const request = FinInterpreter.parse(message, { month: $('month').value, lastIntent });
      const answer = FinTools.execute(request, source.snapshot, source.ledger);
      if (request.month !== $('month').value) { $('month').value = request.month; render(); await mutate(() => FinStore.saveSettings({ selectedMonth: request.month })); }
      if (request.intent !== 'help' && request.intent !== 'draft' && request.intent !== 'simulate') lastIntent = request.intent;
      appendChat('Fin · simulador local', answer.text, answer);
      if (answer.draft) {
        if (draft && !confirm('Substituir o rascunho ainda não confirmado?')) return;
        draft = true; requestId = crypto.randomUUID(); const d = answer.draft;
        $('description').value = d.description; $('value').value = d.value; $('expense-date').value = d.date; $('entry-kind').value = d.kind;
        $('category').value = ledger.settings.categories.includes(d.category) ? d.category : ledger.settings.categories[0];
        $('draft-status').textContent = 'Rascunho da conversa · ainda não gravado. Preencha os campos ausentes e confira todos os dados antes de confirmar.'; updateEntry(); $('entry-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (error) { appendChat('Fin · simulador local', error.message); }
    finally { $('chat-send').disabled = false; }
  }
  $('chat-form').onsubmit = event => { event.preventDefault(); if ($('chat-send').disabled) return; const q = $('chat-input').value.trim(); if (q) { $('chat-input').value = ''; ask(q); } };
  document.querySelectorAll('[data-question]').forEach(b => { b.onclick = () => { if (!$('chat-send').disabled) ask(b.dataset.question); }; });
  $('refresh').onclick = () => refresh();
  $('month').onchange = async () => {
    try { FinLedger.month($('month').value); await mutate(() => FinStore.saveSettings({ selectedMonth: $('month').value })); await refresh(); }
    catch (error) { status(error.message, true); $('export').disabled = true; }
  };
  $('view').onchange = () => { if (snapshot) render(); };
  $('entry-kind').onchange = updateEntry; $('cancel-draft').onclick = clearDraft;
  $('expense-form').onsubmit = async event => {
    event.preventDefault(); $('save-expense').disabled = true;
    try {
      const kind = $('entry-kind').value;
      const input = { description: $('description').value, date: $('expense-date').value, value: $('value').value, category: $('category').value, recurrence: kind };
      await mutate(() => kind === 'paid' ? FinStore.addExpense(input, requestId) : FinStore.addObligation(input, requestId));
      if (draft) appendChat('Fin · simulador local', 'Lançamento confirmado e gravado no livro do Fin. A Agenda não foi alterada.');
      clearDraft(); await refresh();
    } catch (error) { status(error.message, true); $('draft-status').textContent = 'Não foi possível gravar: ' + error.message; }
    finally { $('save-expense').disabled = false; }
  };
  $('pay-form').onsubmit = async event => {
    event.preventDefault(); $('pay-confirm').disabled = true;
    try { if (!payRequest) throw new Error('Selecione uma conta.'); await mutate(() => FinStore.payOccurrence(payRequest.occurrenceId, $('pay-date').value, payRequest.id)); $('pay-dialog').close(); payRequest = null; await refresh(); }
    catch (error) { $('pay-error').textContent = error.message; }
    finally { $('pay-confirm').disabled = false; }
  };
  $('pay-cancel').onclick = () => { $('pay-dialog').close(); payRequest = null; };
  $('categories-form').onsubmit = async event => {
    event.preventDefault(); $('save-categories').disabled = true;
    try { await mutate(() => FinStore.saveSettings({ categories: $('categories').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean) })); await refresh(); $('backup-status').textContent = 'Categorias atualizadas.'; }
    catch (error) { $('backup-status').textContent = error.message; }
    finally { $('save-categories').disabled = false; }
  };
  $('export').onclick = async () => {
    if (!await refresh() || !snapshot || !report) return;
    download({ ...snapshot, selectedMonth: report.month, expenses: ledger.expenses, obligations: ledger.obligations, report }, `fin-dev-${report.month}.json`);
    status('Arquivo de análise exportado. Para restauração, use Baixar backup.');
  };
  $('backup').onclick = async () => {
    try { download(FinLedger.backup(await FinStore.read()), `fin-backup-${Date.now()}.json`); $('backup-status').textContent = 'Backup restaurável baixado; contém dados financeiros privados. Guarde-o em local seguro.'; }
    catch (error) { $('backup-status').textContent = error.message; }
  };
  $('previous-backup').onclick = async () => {
    try { const saved = await FinStore.previousBackup(); if (!saved) throw new Error('Ainda não houve restauração neste navegador.'); download(saved, `fin-antes-restauracao-${Date.now()}.json`); }
    catch (error) { $('backup-status').textContent = error.message; }
  };
  $('restore-file').onchange = async () => {
    restoreCandidate = null;
    try {
      const file = $('restore-file').files[0]; if (!file) return;
      if (file.size > 10 * 1024 * 1024) throw new Error('Backup maior que 10 MB.');
      const parsed = JSON.parse(await file.text()), normalized = FinLedger.validateBackup(parsed), current = await FinStore.read();
      restoreCandidate = { backup: { ...parsed, state: normalized }, expectedRevision: current.revision };
      $('restore-preview').textContent = `Backup de ${new Date(parsed.createdAt).toLocaleString('pt-BR')}: ${normalized.expenses.length} despesas (incluindo estornos), ${normalized.obligations.length} contas e ${normalized.settings.categories.length} categorias. Substituirá ${current.expenses.length} despesas e ${current.obligations.length} contas. Mês selecionado: ${normalized.settings.selectedMonth}.`;
      $('restore-error').textContent = ''; $('restore-dialog').showModal();
    } catch (error) { $('backup-status').textContent = error.message; }
    finally { $('restore-file').value = ''; }
  };
  $('restore-confirm').onclick = async () => {
    $('restore-confirm').disabled = true;
    try {
      if (!restoreCandidate) throw new Error('Selecione o backup novamente.');
      await mutate(() => FinStore.restore(restoreCandidate.backup, restoreCandidate.expectedRevision));
      restoreCandidate = null; $('restore-dialog').close(); clearDraft(); lastIntent = 'result'; $('chat-log').replaceChildren();
      await refresh({ useSettings: true }); $('backup-status').textContent = 'Backup restaurado. A cópia anterior está disponível para baixar. A Agenda foi preservada.';
    } catch (error) { $('restore-error').textContent = error.message; }
    finally { $('restore-confirm').disabled = false; }
  };
  $('restore-cancel').onclick = () => { restoreCandidate = null; $('restore-dialog').close(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 60000);
  if (!AnaEnvironment.hosted && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw-ana-dev.js', { scope: AnaEnvironment.basePath, updateViaCache: 'none' }).catch(() => {
      // A prévia e o livro continuam utilizáveis; não promete cache offline sem registro.
    });
  }
  updateEntry(); refresh({ initial: true });
})();
