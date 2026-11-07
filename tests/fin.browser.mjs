// Pré-requisito: node preview.mjs; playwright disponível no NODE_PATH.
// Contexto novo, somente fixtures; não usa o perfil pessoal do navegador.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true, channel: process.env.FIN_BROWSER_CHANNEL || 'msedge' });
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: 'America/Sao_Paulo' });
const page = await context.newPage();
const errors = [], external = [];
page.on('pageerror', e => errors.push(e.message));
page.on('request', req => { if (!req.url().startsWith('http://127.0.0.1:43188/')) external.push(req.url()); });
const base = 'http://127.0.0.1:43188/ana-dev/';
try {
  await page.goto(base + 'fin-console.html');
  await page.waitForFunction(() => document.getElementById('status').dataset.error === 'true');
  assert.equal(await page.locator('#export').isDisabled(), true);
  // Criar apenas o banco DEV, mais sentinela original para verificar isolamento.
  const originalFixture = await page.evaluate(async () => {
    const put = (name, storeName, key, value) => new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(storeName);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result, tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(value, key);
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
      };
    });
    const today = FinCore.dateParts().date;
    const fixture = { clients: [{ id: 'fake-client', name: 'TESTE FIN PRIVADO' }], appointments: [
      { id: 'paid', clientId: 'fake-client', clientName: 'TESTE FIN PRIVADO', kind: 'appointment', type: 'Sessão', date: today, start: '10:00', end: '11:00', value: 200, financialStatus: 'Pago', payment: { date: today, method: 'PIX' } },
      { id: 'due', clientId: 'fake-client', kind: 'appointment', type: 'Sessão', date: '2020-01-01', start: '10:00', end: '11:00', value: 150, financialStatus: 'Não pago' }
    ], settings: { view: 'week' } };
    await put(AnaEnvironment.database, AnaEnvironment.store, AnaEnvironment.stateKey, { anaLocalVersion: 1, state: fixture, sync: null });
    await put('agenda-1-0-db', 'original-sentinel', 'main', { sentinel: 'ORIGINAL FICTICIO INTACTO' });
    return JSON.stringify(fixture);
  });
  await page.locator('#refresh').click();
  await page.waitForFunction(() => !document.getElementById('export').disabled);
  assert.match(await page.locator('#cards').innerText(), /200,00/);
  assert.match(await page.locator('#records').innerText(), /150,00/);
  await page.locator('#description').fill('Despesa fictícia de teste');
  await page.locator('#value').fill('50.25');
  await page.locator('#save-expense').click();
  await page.waitForFunction(() => document.getElementById('expenses').textContent.includes('50,25'));
  assert.match(await page.locator('#cards').innerText(), /149,75/);
  await page.reload();
  await page.waitForFunction(() => document.getElementById('expenses').textContent.includes('50,25'));
  // IndexedDB real: duas operações simultâneas com o mesmo ID gravam uma vez.
  const ledger = await page.evaluate(async () => {
    const data = { date: FinCore.dateParts().date, description: 'Idempotência fictícia', value: '10.00' };
    await Promise.all([FinStore.addExpense(data, 'same-request'), FinStore.addExpense(data, 'same-request')]);
    let conflictRejected = false;
    try { await FinStore.addExpense({ ...data, value: 20 }, 'same-request'); } catch { conflictRejected = true; }
    return { entries: await FinStore.expenses(), conflictRejected };
  });
  assert.equal(ledger.entries.filter(e => e.id === 'same-request').length, 1);
  assert.equal(ledger.conflictRejected, true);
  await page.locator('#refresh').click();
  await page.waitForFunction(() => document.getElementById('expenses').children.length === 2);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#expenses button').first().click();
  await page.waitForFunction(() => document.getElementById('expenses').children.length === 1);
  assert.match(await page.locator('#cards').innerText(), /190,00/);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export').click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let contents = ''; for await (const chunk of stream) contents += chunk;
  const exported = JSON.parse(contents);
  assert.equal(exported.schemaVersion, 'fin.agenda.v1');
  assert.equal(exported.report.netCashCents, 19000);
  assert.equal(exported.expenses.filter(e => e.voidedAt).length, 1);
  assert.doesNotMatch(contents, /TESTE FIN PRIVADO/);
  const isolation = await page.evaluate(async () => {
    const read = (name, store, key) => new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1); req.onerror = () => reject(req.error);
      req.onsuccess = () => { const db = req.result, r = db.transaction(store).objectStore(store).get(key); r.onsuccess = () => { db.close(); resolve(r.result); }; };
    });
    return { agenda: await read(AnaEnvironment.database, AnaEnvironment.store, AnaEnvironment.stateKey), original: await read('agenda-1-0-db', 'original-sentinel', 'main') };
  });
  assert.equal(isolation.original.sentinel, 'ORIGINAL FICTICIO INTACTO');
  assert.equal(JSON.stringify(isolation.agenda.state), originalFixture);
  assert.equal(isolation.agenda.state.appointments.length, 2);
  assert.equal(isolation.agenda.state.appointments[0].financialStatus, 'Pago');
  // Verificar também o fallback exato da Ana e falha fechada após perda da fonte.
  await page.evaluate(() => {
    localStorage.setItem(AnaEnvironment.fallbackMarker, 'active');
    localStorage.setItem(AnaEnvironment.fallbackKey, JSON.stringify({ clients: [], appointments: [] }));
  });
  await page.locator('#refresh').click();
  await page.waitForFunction(() => document.getElementById('cards').textContent.includes('R$ 0,00'));
  await page.evaluate(() => localStorage.removeItem(AnaEnvironment.fallbackKey));
  await page.locator('#refresh').click();
  await page.waitForFunction(() => document.getElementById('status').dataset.error === 'true');
  assert.equal(await page.locator('#export').isDisabled(), true);
  assert.equal(await page.locator('#cards').textContent(), '');
  await page.evaluate(() => localStorage.removeItem(AnaEnvironment.fallbackMarker));
  await page.locator('#refresh').click();
  await page.waitForFunction(() => !document.getElementById('export').disabled);
  await page.screenshot({ path: fileURLToPath(new URL('../test-results/fin-local.png', import.meta.url)), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: fileURLToPath(new URL('../test-results/fin-mobile.png', import.meta.url)), fullPage: true });
  await page.goto(base);
  await page.locator('[data-tab="summary"]').click();
  await page.getByRole('link', { name: 'Abrir Financeiro Fin ↗' }).waitFor();
  assert.equal(await page.locator('body').innerText().then(text => text.includes('Ana DEV')), true);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('Fin: navegador aprovado — leitura, despesas, persistência, concorrência, estorno, exportação, fallback, isolamento e layout móvel.');
} finally { await context.close(); await browser.close(); }
