/* Ana DEV: sincronização opt-in por snapshot, CAS no servidor e recuperação explícita. */
(() => {
  'use strict';
  const environment = window.AnaEnvironment;
  if (!environment?.isAllowed()) return;
  const CONFIG_KEY = environment.cloudConfigKey;
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/+esm';
  const instance = crypto.randomUUID();
  const draftKey = environment.draftPrefix + instance;
  let api, client, engine, user, timer, locked = false;
  let statusElement, badge, choices, drafts;
  const config = () => { try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}'); } catch { return {}; } };
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('ana-dev-sync-v1') : null;
  function status(name, message = '') {
    if (badge) { badge.textContent = name; badge.dataset.state = name; }
    if (statusElement) statusElement.textContent = `${name} · ${message}`;
  }
  async function getClient() {
    if (client) return client;
    const c = config();
    if (c.url !== environment.cloudUrl || !/^sb_publishable_[\w-]+$/.test(c.key || '')) throw new Error('Configure a URL Secretaria Ana e sua chave pública sb_publishable_.');
    const { createClient } = await import(SDK_URL);
    client = createClient(c.url, c.key, { auth: { storageKey:environment.authStorageKey,
      autoRefreshToken: true, persistSession: true, detectSessionInUrl: false } });
    client.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') { user = null; engine?.signOut(); } });
    return client;
  }
  async function requireUser(expected) {
    const c = await getClient();
    const { data, error } = await c.auth.getUser();
    if (error || !data?.user) throw new Error('Faça login no Supabase para continuar.');
    if (expected && expected !== data.user.id) throw new Error('A conta autenticada mudou. Sincronização interrompida.');
    return { c, account: data.user };
  }
  async function readRemote(owner) {
    const { c } = await requireUser(owner);
    const { data, error } = await c.from('agenda_snapshots').select('revision,payload').eq('owner_id', owner).maybeSingle();
    if (error) throw error;
    return data;
  }
  async function writeRemote(owner, revision, payload) {
    const operation = async () => {
      const { c } = await requireUser(owner);
      const { data, error } = await c.rpc('write_agenda_snapshot', { p_expected_revision: revision, p_payload: payload });
      if (error) throw error;
      return data;
    };
    return navigator.locks ? navigator.locks.request('ana-dev-snapshot-write', operation) : operation();
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(() => engine.sync(), 650); }
  function archive(data, meta) {
    localStorage.setItem(environment.archivePrefix + crypto.randomUUID(), JSON.stringify({ data, meta, savedAt: new Date().toISOString() }));
  }
  function createEngine(data, meta) {
    return new window.AnaSync.Engine({ data, meta, online: () => navigator.onLine,
      status, schedule, read: readRemote, write: writeRemote, archive,
      persist: async (next, metadata) => {
        localStorage.setItem(draftKey, JSON.stringify({ data: next, meta: metadata, savedAt: new Date().toISOString() }));
        await api.persist(next, metadata);
      },
      replace: next => api.replaceState(next),
      committed: revision => channel?.postMessage({ instance, owner: user?.id, revision })
    });
  }
  async function run(action) {
    if (locked) return;
    locked = true;
    try { await action(); }
    catch (error) { status(navigator.onLine ? 'Erro' : 'Offline', error.message || String(error)); }
    finally { locked = false; }
  }
  function button(label, action) {
    const item = document.createElement('button'); item.type = 'button'; item.className = 'secondary-button';
    item.textContent = label; item.addEventListener('click', () => run(action)); return item;
  }
  function confirmAction(message) {
    const dialog = document.createElement('dialog'); dialog.className = 'modal confirm-modal';
    const form = document.createElement('form'); form.method = 'dialog';
    const title = document.createElement('h2'); title.textContent = 'Confirmar operação Ana DEV';
    const text = document.createElement('p'); text.textContent = message;
    const controls = document.createElement('div'); controls.className = 'modal-actions';
    for (const [label, value] of [['Cancelar', 'cancel'], ['Confirmar', 'confirm']]) {
      const control = document.createElement('button'); control.type = 'submit'; control.value = value;
      control.textContent = label; control.className = 'secondary-button'; controls.append(control);
    }
    form.append(title, text, controls); dialog.append(form); document.body.append(dialog);
    return new Promise(resolve => {
      dialog.addEventListener('close', () => { const accepted = dialog.returnValue === 'confirm'; dialog.remove(); resolve(accepted); }, { once: true });
      dialog.showModal();
    });
  }
  function field(title, type, value = '') {
    const label = document.createElement('label'); label.className = 'field full';
    const name = document.createElement('span'); name.textContent = title;
    const input = document.createElement('input'); input.type = type; input.value = value;
    label.append(name, input); return { label, input };
  }
  function download(data, name) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function listDrafts() {
    drafts.replaceChildren();
    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Selecione uma cópia de recuperação'; drafts.append(placeholder);
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key.startsWith(environment.draftPrefix) && !key.startsWith(environment.archivePrefix)) continue;
      try {
        const item = JSON.parse(localStorage.getItem(key));
        if (item.meta?.owner && item.meta.owner !== user?.id) continue;
        const option = document.createElement('option'); option.value = key;
        option.textContent = `${item.savedAt} · ${item.data.clients.length} cadastros · revisão ${item.meta?.revision ?? 'não vinculada'}${item.meta?.dirty ? ' · pendente' : ''}`;
        drafts.append(option);
      } catch { /* Uma cópia inválida não impede acesso às demais. */ }
    }
  }
  async function selectSource(source, recoverOnly = false) {
    const message = source === 'remote'
      ? 'Recuperar a cópia remota e substituir a agenda Ana DEV local? Uma cópia local de recuperação será preservada.'
      : 'Usar a cópia LOCAL como fonte e substituir o snapshot de TESTE remoto na revisão consultada? Confirme que todos os registros são fictícios.';
    if (!await confirmAction(message + (recoverOnly ? ' A sincronização continuará desativada.' : ' Isso ativa o envio automático das próximas alterações fictícias.'))) return;
    api.downloadBackup();
    const success = await engine.choose(source);
    if (recoverOnly && success) engine.disable();
    choices.replaceChildren(); listDrafts();
  }
  async function activate(recoverOnly = false) {
    engine.disable(); choices.replaceChildren();
    const { account } = await requireUser();
    if (engine.user !== account.id) { user = account; await engine.authenticate(account.id); }
    const decision = await engine.prepare();
    if (recoverOnly) { await selectSource('remote', true); return; }
    if (!decision.different) {
      if (await confirmAction('Ativar sincronização automática somente de dados fictícios? A revisão remota será respeitada.')) await engine.choose('local');
      return;
    }
    const text = document.createElement('p');
    text.textContent = `As fontes são diferentes (remota: revisão ${decision.revision}). Nenhuma foi substituída. Escolha explicitamente:`;
    choices.append(text, button('Ativar usando cópia remota', () => selectSource('remote')),
      button('Ativar usando cópia local', () => selectSource('local')));
    status('Alterações pendentes', 'Decisão entre cópia local e remota necessária.');
  }
  function install(application) {
    api = application;
    const header = document.querySelector('header');
    badge = document.createElement('span'); badge.className = 'ana-sync-badge'; badge.setAttribute('role', 'status');
    const dialog = document.createElement('dialog'); dialog.id = 'ana-cloud-dialog'; dialog.className = 'modal ana-cloud-dialog';
    header.append(badge, button('Nuvem / Ana', async () => { listDrafts(); dialog.showModal(); }));
    const title = document.createElement('h2'); title.textContent = 'Ana DEV — sincronização de testes';
    const note = document.createElement('p'); note.textContent = 'Somente dados fictícios. A ativação é explícita a cada abertura ou login. Conflitos preservam as cópias sem mesclagem automática.';
    const stored = config();
    const url = field('URL do projeto', 'url', stored.url || environment.cloudUrl);
    const key = field('Chave publishable', 'text', stored.key || '');
    const email = field('E-mail administrador', 'email');
    const password = field('Senha', 'password'); password.input.autocomplete = 'current-password';
    statusElement = document.createElement('p'); statusElement.id = 'ana-cloud-status'; statusElement.setAttribute('role', 'status');
    choices = document.createElement('div'); choices.className = 'ana-source-choices';
    drafts = document.createElement('select'); drafts.setAttribute('aria-label', 'Cópias locais de recuperação');
    const controls = document.createElement('div'); controls.className = 'ana-cloud-controls';
    engine = createEngine(api.getState(), api.getMetadata());
    controls.append(
      button('Salvar configuração', async () => {
        const c = { url: url.input.value.trim().replace(/\/$/, ''), key: key.input.value.trim() };
        if (c.url !== environment.cloudUrl || !/^sb_publishable_[\w-]+$/.test(c.key)) throw new Error('Use a URL Secretaria Ana e chave pública sb_publishable_.');
        engine.signOut(); await engine.operation; user = null; client = null;
        localStorage.setItem(CONFIG_KEY, JSON.stringify(c)); status('Alterações pendentes', 'Configuração salva. Faça login.');
      }),
      button('Entrar', async () => {
        engine.disable(); await engine.operation;
        const c = await getClient();
        let result;
        try { result = await c.auth.signInWithPassword({ email: email.input.value.trim(), password: password.input.value }); }
        finally { password.input.value = ''; }
        if (result.error) throw result.error;
        user = result.data.user;
        await engine.authenticate(user.id); listDrafts();
      }),
      button('Ativar sincronização', () => activate()),
      button('Desativar sincronização', async () => { engine.disable(); choices.replaceChildren(); await engine.operation; }),
      button('Verificar estado remoto', () => engine.inspect()),
      button('Tentar sincronizar novamente', () => engine.sync()),
      button('Exportar backup local', () => api.downloadBackup()),
      button('Recuperar cópia remota', () => activate(true)),
      button('Exportar cópia remota', async () => {
        const { account } = await requireUser();
        const remote = await readRemote(account.id);
        if (!remote) throw new Error('Nenhuma agenda remota.');
        window.AnaSync.validate(remote.payload); download(remote.payload, `ana-dev-nuvem-revisao-${remote.revision}.json`);
      }),
      button('Sair', async () => {
        engine.disable(); await engine.operation;
        const c = await getClient(); const { error } = await c.auth.signOut({ scope: 'local' });
        if (error) throw error; engine.signOut(); user = null; status('Alterações pendentes', 'Sessão encerrada.');
      }),
      button('Fechar', () => dialog.close())
    );
    const recovery = button('Restaurar cópia local selecionada', async () => {
      if (!drafts.value) throw new Error('Selecione uma cópia.');
      const selected = JSON.parse(localStorage.getItem(drafts.value));
      window.AnaSync.validate(selected.data);
      if (selected.meta?.owner && selected.meta.owner !== user?.id) throw new Error('Entre com a conta proprietária desta cópia.');
      if (!await confirmAction('Restaurar esta cópia fictícia local? A atual será preservada e a sincronização ficará desativada.')) return;
      engine.disable(); await engine.operation;
      await archive(api.getState(), engine.meta); api.downloadBackup();
      engine = createEngine(selected.data, selected.meta); await engine.persist(); api.replaceState(selected.data);
      if (user) await engine.authenticate(user.id);
      choices.replaceChildren(); listDrafts();
    });
    dialog.append(title, note, url.label, key.label, email.label, password.label, controls, statusElement, choices, drafts, recovery);
    document.body.append(dialog);
    channel?.addEventListener('message', event => {
      if (event.data.instance !== instance && event.data.owner === user?.id && engine.enabled) engine.sync();
    });
    window.addEventListener('online', () => {
      if (engine.enabled) engine.sync();
      else status('Alterações pendentes', 'Conexão restabelecida. Sincronização continua desativada.');
    });
    window.addEventListener('offline', () => status('Offline', 'Dados locais preservados; a revisão será verificada ao reconectar.'));
    window.setInterval(() => { if (engine.enabled && !engine.paused) engine.sync(); }, 20000);
    if (stored.key) run(async () => {
      const { account } = await requireUser(); user = account; await engine.authenticate(user.id);
    });
  }
  window.AnaCloud = { install, localChanged: data => engine.localChanged(data) };
})();
