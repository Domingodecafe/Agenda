// Requer a prévia local e Playwright no NODE_PATH. Usa um perfil descartável.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');
const fallback = process.env.AGENDA_CHAT_FALLBACK === '1';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 740 }, timezoneId: 'America/Sao_Paulo' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-11-07T15:00:00Z'));
  const app = 'http://127.0.0.1:43188/ana-dev/';
  const setup = app + 'preparar-teste-chat';
  await page.route(setup, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Teste</title>' }));
  await page.goto(setup);
  await page.evaluate(async fallback => {
    const state = { clients: [{ id: 'lia', name: 'Lia Teste' }], appointments: [
      { id: 's1', kind: 'appointment', date: '2026-11-10', start: '08:00', end: '09:00', value: 125,
        financialStatus: 'Pago', payment: { date: '2026-11-07' } },
      { id: 'b1', kind: 'block', date: '2026-11-10', start: '09:30', end: '10:15' },
    ], settings: { view: 'month' } };
    const envelope = { anaLocalVersion: 1, state, sync: null };
    if (fallback) {
      localStorage.setItem('ana-dev-agenda-fallback-active-v1', 'active');
      localStorage.setItem('ana-dev-agenda-state-v1', JSON.stringify(envelope));
      return;
    }
    await new Promise((resolve, reject) => {
      const open = indexedDB.open('ana-dev-agenda-db-v1', 1);
      open.onerror = () => reject(open.error);
      open.onupgradeneeded = () => open.result.createObjectStore('ana-dev-agenda');
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('ana-dev-agenda', 'readwrite');
        tx.objectStore('ana-dev-agenda').put(envelope, 'ana-dev-main');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  }, fallback);
  const calls = [];
  await page.route(app + 'api/chat', async route => {
    const data = route.request().postDataJSON();
    calls.push(data);
    if (data.message === 'Erro') return route.fulfill({ status: 503, json: { error: 'Falha simulada' } });
    if (data.message === 'Agende') return route.fulfill({ json: { reply: 'Qual o nome, a data e o horário?' } });
    const bookings = {
      Novo: { name: 'Geraldinho Teste', date: '2026-11-13', start: '18:00', modality: 'Presencial' },
      Existente: { name: 'Lia Teste', date: '2026-11-10', start: '11:00', modality: 'Online' },
      Ocupado: { name: 'Outro Teste', date: '2026-11-10', start: '08:00', modality: 'Presencial' },
      Bloqueado: { name: 'Outro Teste', date: '2026-11-10', start: '10:00', modality: 'Presencial' },
      Fora: { name: 'Outro Teste', date: '2026-11-13', start: '19:00', modality: 'Presencial' },
      Falhar: { name: 'Outro Teste', date: '2026-11-13', start: '17:00', modality: 'Presencial' },
    };
    if (bookings[data.message]) return route.fulfill({ json: { booking: bookings[data.message] } });
    if (data.agent) {
      return route.fulfill({ json: { id: data.agent, period: data.agent === 'ana' ? '2026-11-10' : '2026-11' } });
    }
    return route.fulfill({ json: { reply: data.id === 'ana' ? 'Horários consultados.' : 'Recebimentos consultados.' } });
  });
  await page.goto(app);
  await page.locator('#agenda-menu summary').click();
  await page.getByRole('button', { name: 'Abrir chat dos agentes', exact: true }).click();
  assert.ok(await page.getByRole('dialog').isVisible());
  const records = () => page.evaluate(async fallback => {
    const envelope = fallback ? JSON.parse(localStorage.getItem('ana-dev-agenda-state-v1')) : await new Promise((resolve, reject) => {
      const open = indexedDB.open(AnaEnvironment.database);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const request = db.transaction(AnaEnvironment.store).objectStore(AnaEnvironment.store).get(AnaEnvironment.stateKey);
        request.onsuccess = () => { db.close(); resolve(request.result); };
        request.onerror = () => { db.close(); reject(request.error); };
      };
    });
    const { clients, appointments } = envelope.state;
    return { clients, appointments };
  }, fallback);
  const before = await records();
  const input = page.getByRole('textbox', { name: 'Pergunta' });
  async function ask(text) {
    await input.fill(text);
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  }
  await ask('Quais horários estão livres?');
  await page.getByText('Horários consultados.').waitFor();
  assert.deepEqual(calls[1].result, { starts: ['11:00', '14:00', '15:00', '16:00', '17:00', '18:00'] });
  await page.getByRole('button', { name: 'Fin', exact: true }).click();
  assert.equal(await page.getByText('Horários consultados.').isVisible(), false);
  await ask('Quanto recebi?');
  await page.getByText('Recebimentos consultados.').waitFor();
  assert.deepEqual(calls[3].result, { receivedCents: 12500 });
  await ask('Erro');
  await page.getByText('Falha simulada').waitFor();
  assert.equal(await input.inputValue(), 'Erro');
  await page.getByRole('button', { name: 'Ana', exact: true }).click();
  assert.ok(await page.getByText('Horários consultados.').isVisible());
  await ask('Agende');
  await page.getByText('Qual o nome, a data e o horário?').waitFor();
  assert.deepEqual(await records(), before);
  await ask('Novo');
  await page.getByText(/Atendimento agendado para Geraldinho Teste/).waitFor();
  await ask('Novo');
  await page.getByText(/Esse atendimento já está na Agenda/).waitFor();
  await ask('Existente');
  await page.getByText(/Atendimento agendado para Lia Teste/).waitFor();
  for (const [index, text] of ['Ocupado', 'Bloqueado', 'Fora'].entries()) {
    await ask(text);
    await page.getByText(/Esse horário está ocupado/).nth(index).waitFor();
  }
  await page.evaluate(fallback => {
    if (!fallback) {
      IDBObjectStore.prototype.put = function () { throw new Error('Falha simulada no disco'); };
      return;
    }
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'ana-dev-agenda-state-v1') throw new Error('Falha simulada no disco');
      return setItem.call(this, key, value);
    };
  }, fallback);
  await ask('Falhar');
  await page.getByText(/Não foi possível salvar o atendimento/).waitFor();
  const after = await records();
  assert.equal(after.clients.length, 2);
  assert.equal(after.appointments.length, 4);
  const [newClient, existing] = after.appointments.slice(2);
  assert.equal(newClient.end, '19:00');
  assert.equal(newClient.value, 200);
  assert.equal(newClient.financialStatus, 'A receber');
  assert.equal(existing.clientId, 'lia');
  assert.equal(existing.modality, 'Online');
  await page.reload();
  await page.locator('#agent-chat-nav:enabled').waitFor({ state: 'attached' });
  await page.locator('#next-date').click();
  await page.locator(`#calendar [data-event-id="${newClient.id}"]`).waitFor();
  assert.deepEqual(await records(), after);
  assert.deepEqual(errors, []);
  console.log(`Chat no navegador aprovado com API simulada e ${fallback ? 'localStorage' : 'IndexedDB'}.`);
} finally {
  await browser.close();
}
