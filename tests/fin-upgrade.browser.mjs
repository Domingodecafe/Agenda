// Requer node preview.mjs e Playwright no NODE_PATH. Usa somente perfil descartável.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ headless: true, channel: process.env.FIN_BROWSER_CHANNEL || 'msedge' });
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: 'America/Sao_Paulo' });
await context.addInitScript(() => {
  const RealDate = Date, fixed = RealDate.parse('2026-10-29T15:00:00Z');
  globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return fixed; } };
});
const page = await context.newPage(), errors = [], external = [];
page.on('pageerror', error => errors.push(error.message));
context.on('request', req => { if (/^(https?|wss?):/.test(req.url()) && !req.url().startsWith('http://127.0.0.1:43188/')) external.push(req.url()); });
const base = 'http://127.0.0.1:43188/ana-dev/';
const read = () => page.evaluate(() => FinStore.read());
const ask = async text => {
  await page.locator('#chat-input').fill(text); await page.locator('#chat-send').click();
  await page.waitForFunction(() => !document.getElementById('chat-send').disabled);
  return page.locator('#chat-log .chat-message').last().innerText();
};
const selectMonth = async value => {
  await page.locator('#month').fill(value); await page.locator('#month').dispatchEvent('change');
  await page.waitForFunction(m => document.getElementById('status').dataset.error === 'false' && document.getElementById('insight').textContent.length > 30 && document.getElementById('month').value === m, value);
  await page.waitForFunction(m => FinStore.read().then(s => s.settings.selectedMonth === m), value);
};
const downloadJSON = async selector => {
  const pending = page.waitForEvent('download'); await page.locator(selector).click();
  const stream = await (await pending).createReadStream(); let text = '';
  for await (const chunk of stream) text += chunk;
  return JSON.parse(text);
};
const upload = async data => {
  await page.locator('#restore-file').setInputFiles({ name: 'fin-test.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
};
try {
  await page.goto(base + 'fin-console.html'); await page.evaluate(() => navigator.serviceWorker.ready);
  const originalFixture = await page.evaluate(async () => {
    const put = (name, store, key, value) => new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1); req.onupgradeneeded = () => req.result.createObjectStore(store);
      req.onerror = () => reject(req.error); req.onsuccess = () => {
        const db = req.result, tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(value, key);
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
      };
    });
    const appointment = (id, value, date, overrides = {}) => ({ id, clientId: 'FAKE-CLIENT', clientName: 'FICTICIO PRIVADO', kind: 'appointment', type: 'Sessão', date, start: '10:00', end: '11:00', value, ...overrides });
    const fixture = { clients: [{ id: 'FAKE-CLIENT', name: 'FICTICIO PRIVADO' }], appointments: [
      appointment('paid', 200, '2026-11-01', { financialStatus: 'Pago', payment: { date: '2026-10-10', method: 'PIX' } }),
      appointment('future1', 100, '2026-10-30'), appointment('future2', 200, '2026-10-31'), appointment('future3', 300, '2026-10-31'),
      appointment('due', 999, '2026-10-01'), appointment('cancelled', 100, '2026-10-31', { status: 'Cancelado' })
    ], settings: { view: 'week' } };
    await put(AnaEnvironment.database, AnaEnvironment.store, AnaEnvironment.stateKey, { anaLocalVersion: 1, state: fixture, sync: null });
    await put('agenda-1-0-db', 'sentinel', 'main', { value: 'ORIGINAL INTACTO' });
    await put('fin-dev-finance-v1', 'ledger', 'expenses', [
      { id: 'legacy-paid', description: 'Despesa legada fictícia', date: '2026-10-10', amountCents: 1025, actor: 'owner-local', createdAt: '2026-10-10T12:00:00Z' },
      { id: 'legacy-void', description: 'Estorno legado fictício', date: '2026-10-10', amountCents: 1000, actor: 'owner-local', createdAt: '2026-10-10T12:00:00Z', voidedAt: '2026-10-11T12:00:00Z' }
    ]);
    return JSON.stringify(fixture);
  });
  await page.goto(base + 'fin-console.html');
  await page.waitForFunction(() => !document.getElementById('export').disabled);
  assert.match(await page.locator('#insight').innerText(), /789,75/);
  let current = await read();
  assert.equal(current.expenses.length, 2); assert.equal(current.expenses[0].id, 'legacy-paid'); assert.ok(current.expenses[1].voidedAt);
  await context.setOffline(true); await page.reload();
  await page.waitForFunction(() => !document.getElementById('export').disabled);
  assert.match(await ask('Quanto deve sobrar até o fim do mês?'), /789,75/);
  assert.match(await ask('E no mês anterior?'), /Mês encerrado/);
  assert.equal(await page.locator('#month').inputValue(), '2026-09');
  await selectMonth('2026-10');
  const beforeSimulation = await read();
  const simulation = await ask('E se eu tiver duas sessões a menos?');
  assert.match(simulation, /289,75/); assert.match(simulation, /489,75/);
  assert.equal(JSON.stringify(await read()), JSON.stringify(beforeSimulation));
  assert.match(await ask('Quanto tenho para receber?'), /999,00/);
  assert.match(await ask('Compare este mês com o anterior.'), /Diferença do resultado/);
  const beforeDraft = await read();
  await ask('Prepare uma despesa de R$ 150 de aluguel.');
  assert.equal(await page.locator('#description').inputValue(), 'aluguel');
  assert.equal(await page.locator('#save-expense').innerText(), 'Confirmar rascunho');
  assert.equal(JSON.stringify(await read()), JSON.stringify(beforeDraft));
  await page.locator('#save-expense').click();
  await page.waitForFunction(() => document.getElementById('expenses').textContent.includes('aluguel'));
  assert.match(await page.locator('#insight').innerText(), /639,75/);
  await page.locator('#entry-kind').selectOption('monthly');
  await page.locator('#description').fill('Internet fictícia'); await page.locator('#expense-date').fill('2026-10-31'); await page.locator('#value').fill('50');
  await page.locator('#save-expense').click();
  await page.waitForFunction(() => document.getElementById('obligations').textContent.includes('Internet fictícia'));
  assert.match(await page.locator('#insight').innerText(), /589,75/);
  await page.locator('#obligations').getByRole('button', { name: 'Pagar', exact: true }).click();
  await page.locator('#pay-confirm').click();
  await page.waitForFunction(() => document.getElementById('obligations').textContent.includes('Paga'));
  assert.match(await page.locator('#insight').innerText(), /589,75/);
  current = await read(); assert.equal(current.expenses.filter(e => e.occurrenceId).length, 1);
  page.once('dialog', d => d.accept()); await page.locator('#expenses tr').filter({ hasText: 'Internet fictícia' }).getByRole('button').click();
  await page.waitForFunction(() => document.getElementById('obligations').textContent.includes('Aberta'));
  assert.match(await page.locator('#insight').innerText(), /589,75/);
  page.once('dialog', d => d.accept()); await page.locator('#obligations').getByRole('button', { name: 'Cancelar ocorrência' }).click();
  await page.waitForFunction(() => document.getElementById('obligations').textContent.includes('Cancelada'));
  assert.match(await page.locator('#insight').innerText(), /639,75/);
  await selectMonth('2026-11');
  await page.waitForFunction(() => document.getElementById('obligations').textContent.includes('Aberta'));
  await selectMonth('2026-10');
  await page.getByText('Categorias e cópias de segurança', { exact: true }).click();
  await page.locator('#categories').fill((await page.locator('#categories').inputValue()) + '\nSupervisão'); await page.locator('#save-categories').click();
  await page.waitForFunction(() => document.getElementById('backup-status').textContent.includes('Categorias atualizadas'));
  const backup = await downloadJSON('#backup');
  assert.equal(backup.schemaVersion, 'fin.backup.v2'); assert.equal(backup.state.settings.categories.includes('Supervisão'), true);
  assert.doesNotMatch(JSON.stringify(backup), /FICTICIO PRIVADO|appointments/);
  await page.evaluate(() => FinStore.addExpense({ description: 'Extra após backup', date: '2026-10-29', value: '25' }, 'extra'));
  const beforePreview = await read();
  await upload(backup); await page.locator('#restore-dialog').waitFor({ state: 'visible' });
  assert.equal(JSON.stringify(await read()), JSON.stringify(beforePreview));
  await page.locator('#restore-cancel').click(); assert.equal(JSON.stringify(await read()), JSON.stringify(beforePreview));
  await upload(backup); await page.locator('#restore-confirm').click();
  await page.waitForFunction(() => document.getElementById('backup-status').textContent.includes('Backup restaurado'));
  current = await read(); assert.equal(current.expenses.some(e => e.id === 'extra'), false);
  assert.equal(JSON.stringify(current.expenses), JSON.stringify(backup.state.expenses));
  const recovery = await downloadJSON('#previous-backup'); assert.equal(recovery.state.expenses.some(e => e.id === 'extra'), true);
  // Alteração em outra instância após a prévia deve bloquear substituição.
  await upload(backup); await page.locator('#restore-dialog').waitFor({ state: 'visible' });
  await page.evaluate(() => FinStore.addExpense({ description: 'Alteração concorrente', date: '2026-10-29', value: '1' }, 'concurrent'));
  await page.locator('#restore-confirm').click();
  await page.waitForFunction(() => document.getElementById('restore-error').textContent.includes('mudou após a prévia'));
  assert.equal((await read()).expenses.some(e => e.id === 'concurrent'), true); await page.locator('#restore-cancel').click();
  const invalid = structuredClone(backup); invalid.state.obligations.push(invalid.state.obligations[0]);
  const beforeInvalid = await read(); await upload(invalid);
  await page.waitForFunction(() => document.getElementById('backup-status').textContent.includes('repetidos'));
  assert.equal(JSON.stringify(await read()), JSON.stringify(beforeInvalid));
  await upload({ schemaVersion: 'fin.agenda.v1' });
  await page.waitForFunction(() => document.getElementById('backup-status').textContent.includes('não é um backup'));
  // Falha após put de despesas, antes do commit: toda a transação deve voltar atrás.
  await ask('Prepare uma despesa de R$ 10 de falha fictícia.');
  const beforeFailure = await read();
  await page.evaluate(() => {
    globalThis.finOriginalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) {
      const req = finOriginalPut.call(this, value, key);
      if (this.name === 'ledger' && key === 'planning') this.transaction.abort();
      return req;
    };
  });
  await page.locator('#save-expense').click();
  await page.waitForFunction(() => document.getElementById('draft-status').textContent.includes('Não foi possível gravar'));
  await page.evaluate(() => { IDBObjectStore.prototype.put = finOriginalPut; });
  assert.equal(JSON.stringify(await read()), JSON.stringify(beforeFailure));
  assert.equal(await page.locator('#save-expense').innerText(), 'Confirmar rascunho');
  assert.doesNotMatch(await page.locator('#chat-log .chat-message').last().innerText(), /confirmado e gravado/);
  await page.locator('#save-expense').click();
  await page.waitForFunction(() => document.getElementById('expenses').textContent.includes('falha fictícia'));
  assert.equal((await read()).expenses.filter(e => e.description === 'falha fictícia').length, 1);
  await page.reload(); await page.waitForFunction(() => !document.getElementById('export').disabled);
  assert.equal((await read()).obligations.length, 1); assert.equal(await page.locator('#month').inputValue(), '2026-10');
  const isolation = await page.evaluate(async () => {
    const get = (name, store, key) => new Promise((resolve, reject) => {
      const r = indexedDB.open(name, 1); r.onerror = () => reject(r.error); r.onsuccess = () => { const db = r.result, q = db.transaction(store).objectStore(store).get(key); q.onsuccess = () => { db.close(); resolve(q.result); }; };
    });
    return { agenda: await get(AnaEnvironment.database, AnaEnvironment.store, AnaEnvironment.stateKey), original: await get('agenda-1-0-db', 'sentinel', 'main') };
  });
  assert.equal(JSON.stringify(isolation.agenda.state), originalFixture); assert.equal(isolation.original.value, 'ORIGINAL INTACTO');
  await ask('Quanto deve sobrar?');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: fileURLToPath(new URL('../test-results/fin-upgrade-desktop.png', import.meta.url)) });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: fileURLToPath(new URL('../test-results/fin-upgrade-mobile.png', import.meta.url)) });
  await page.locator('#entry-panel').scrollIntoViewIfNeeded();
  await page.screenshot({ path: fileURLToPath(new URL('../test-results/fin-upgrade-form-mobile.png', import.meta.url)) });
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('Fin upgrade: navegador aprovado — migração v1, chat, projeção, simulação, rascunhos, contas, estornos, categorias, backup/restauração, conflito, rollback transacional e uso offline; Agenda preservada.');
} finally { await context.close(); await browser.close(); }
