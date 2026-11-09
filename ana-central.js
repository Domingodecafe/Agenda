(() => {
  'use strict';
  const environment = globalThis.AnaEnvironment;
  if (!environment?.isAllowed()) return;
  const byId = id => document.getElementById(id);
  const status = byId('queue-status');
  const refresh = byId('queue-refresh');
  const endpoint = './api/ana-queue';
  const labels = {
    approved: 'Aprovada', rejected: 'Recusada', expired: 'Vencida',
    resolved: 'Resolvido', stale: 'Precisa de nova revisão', superseded: 'Substituída',
  };
  const date = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short',
  });
  let busy = false;

  function element(tag, text, parent) {
    const node = document.createElement(tag);
    node.textContent = text;
    parent.append(node);
    return node;
  }

  function record(item, list, expanded) {
    const row = element('li', '', list);
    const details = element('details', '', row);
    details.open = expanded.has(item.id);
    details.dataset.itemId = item.id;
    const heading = element('summary', '', details);
    element('strong', item.title, heading);
    const pending = item.status === 'pending';
    const label = pending ? (item.kind === 'approval' ? 'Aguardando aprovação' : 'Para revisar') : labels[item.status];
    element('small', `${label} · ${date.format(item.createdAt)} · ${item.source === 'voice' ? 'Voz' : 'Texto'}`, heading);
    if (item.review) {
      const { items, paid, scope } = item.review;
      element('p', `${scope} · ${items.length} atendimento(s) · ${paid} com pagamento registrado`, details);
      if (pending) element('p', `Aprovação disponível até ${date.format(item.expiresAt)}.`, details);
      const review = element('ul', '', details);
      review.className = 'ana-review';
      for (const appointment of items) element('li', appointment, review);
    } else {
      element('p', item.summary, details);
    }
    if (!pending) return;
    const controls = element('div', '', details);
    controls.className = 'ana-actions';
    const actions = item.kind === 'approval'
      ? [['approve', 'Confirmar exclusão'], ['reject', 'Recusar pedido']]
      : [['resolve', 'Marcar como resolvido']];
    for (const [action, label] of actions) {
      const button = element('button', label, controls);
      button.type = 'button';
      button.dataset.action = action;
      button.addEventListener('click', () => update({ id: item.id, action }));
    }
  }

  function render(items) {
    const expanded = new Set([...document.querySelectorAll('details[open][data-item-id]')].map(node => node.dataset.itemId));
    const approvals = items.filter(item => item.status === 'pending' && item.kind === 'approval');
    const notices = items.filter(item => item.status === 'pending' && item.kind === 'notice');
    const history = items.filter(item => item.status !== 'pending')
      .sort((a, b) => (b.decidedAt || b.expiresAt) - (a.decidedAt || a.expiresAt));
    byId('approval-count').textContent = approvals.length;
    byId('notice-count').textContent = notices.length;
    for (const [id, records, empty] of [
      ['approvals', approvals, 'Nenhum pedido aguardando aprovação.'],
      ['notices', notices, 'Nenhum aviso para revisar.'],
      ['history', history, 'Nenhuma decisão registrada.'],
    ]) {
      const list = byId(id);
      list.replaceChildren();
      if (!records.length) element('li', empty, list);
      for (const item of records) record(item, list, expanded);
    }
  }

  async function request(options) {
    const response = await fetch(endpoint, { cache: 'no-store', ...options });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível atualizar a Central da Ana.');
    return data;
  }

  async function update(decision) {
    if (busy) return;
    busy = true;
    refresh.disabled = true;
    const buttons = [...document.querySelectorAll('button[data-action]')];
    for (const button of buttons) button.disabled = true;
    try {
      const result = decision && await request({
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(decision),
      });
      const { items } = await request();
      render(items);
      status.textContent = result?.reply || '';
      refresh.textContent = 'Atualizar';
      if (decision) {
        status.tabIndex = -1;
        status.focus();
      }
    } catch (error) {
      status.textContent = error instanceof SyntaxError || error instanceof TypeError
        ? 'Não foi possível atualizar a Central da Ana. Tente novamente.'
        : error.message;
      refresh.textContent = 'Tentar novamente';
    } finally {
      busy = false;
      refresh.disabled = false;
      for (const button of buttons) button.disabled = false;
    }
  }

  for (const button of document.querySelectorAll('[data-section]')) {
    button.addEventListener('click', () => {
      const rules = button.dataset.section === 'rules';
      byId('rules').hidden = !rules;
      byId('queue').hidden = rules;
      for (const tab of document.querySelectorAll('[data-section]')) tab.setAttribute('aria-pressed', String(tab === button));
      if (!rules && environment.shared) update();
    });
  }
  refresh.addEventListener('click', () => update());
  if (environment.shared) {
    refresh.hidden = false;
    window.addEventListener('focus', () => { if (!byId('queue').hidden) update(); });
    update();
  } else {
    status.textContent = 'A fila compartilhada está disponível na Agenda DEV hospedada.';
  }
})();
