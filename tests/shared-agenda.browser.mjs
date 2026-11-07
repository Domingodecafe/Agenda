// Navegadores isolados, com o servidor real e serviços externos simulados.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');
const origin = 'https://agenda-dev.example';
const password = 'senha-da-agenda-ficticia';
Object.assign(process.env, {
  AGENDA_DEV_ORIGIN: origin, PORT: '0', AGENDA_DEV_PASSWORD: password, AGENDA_SHARED: 'true',
  AGENDA_SUPABASE_URL: 'https://fixture.supabase.co', AGENDA_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  AGENDA_SUPABASE_EMAIL: 'fixture@example.test', AGENDA_SUPABASE_PASSWORD: 'senha-ficticia',
  OPENAI_API_KEY: 'fake-key', OPENAI_MODEL: 'fake-model',
});

let snapshot;
let lightweightReads = 0;
let modelRequests = 0;
const toolCall = (name, args) => ({ type: 'function_call', name, arguments: JSON.stringify(args), call_id: 'call_fixture' });
const complete = output => Response.json({ status: 'completed', output: [output] });
globalThis.fetch = async (target, options) => {
  const url = new URL(target);
  if (url.hostname === 'fixture.supabase.co') {
    if (url.pathname.startsWith('/auth/')) return Response.json({ access_token: 'token', expires_in: 3600, user: { id: 'test-user' } });
    assert.equal(options.headers.Authorization, 'Bearer token');
    if (url.pathname.endsWith('/rpc/write_agenda_snapshot')) {
      const { p_expected_revision: expected, p_payload: payload } = JSON.parse(options.body);
      if ((snapshot?.revision || 0) !== expected) return Response.json({ message: 'CONFLITO_REVISAO' }, { status: 400 });
      snapshot = { revision: expected + 1, payload };
      return Response.json(snapshot.revision);
    }
    assert.equal(url.searchParams.get('owner_id'), 'eq.test-user');
    if (url.searchParams.get('select') === 'revision') {
      lightweightReads++;
      return Response.json(snapshot ? [{ revision: snapshot.revision }] : []);
    }
    return Response.json(snapshot ? [snapshot] : []);
  }
  assert.equal(url.hostname, 'api.openai.com');
  modelRequests++;
  const { input } = JSON.parse(options.body);
  const last = input.at(-1);
  if (last.type === 'function_call_output') {
    const facts = JSON.parse(last.output);
    return complete({ type: 'message', content: [{ type: 'output_text', text: `Resultado: ${facts.recebidoEmCentavos}` }] });
  }
  if (last.content === 'Consultar Fin') return complete(toolCall('consultar_recebimentos', { mes: '2026-11' }));
  if (last.content === 'Agendar série') return complete(toolCall('agendar_atendimento', {
    nome: 'Cliente Série Teste', data: '2099-11-13', horario: '16:00', modalidade: null,
    frequencia: 'weekly', quantidade: 2, ate: null,
  }));
  if (last.content === 'Apagar série') return complete(toolCall('alterar_atendimento', {
    acao: 'delete', nome: 'Cliente Série Teste', data: '2099-11-13', horario: '16:00', alcance: 'series',
    nova_data: null, novo_horario: null, modalidade: null, valor: null, duracao: null,
  }));
  return complete(toolCall('agendar_atendimento', {
    nome: last.content, data: '2099-11-13', horario: '15:00', modalidade: null,
  }));
};

const { server } = await import('../preview.mjs');
await once(server, 'listening');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const mobile = await browser.newContext({ viewport: { width: 390, height: 750 }, isMobile: true, hasTouch: true });
  async function connect(context) {
    await context.route(origin + '/**', async route => {
      const request = route.request();
      const headers = await request.allHeaders();
      const url = new URL(request.url());
      const result = await new Promise((resolve, reject) => {
        const upstream = http.request({
          hostname: '127.0.0.1', port: server.address().port, path: url.pathname + url.search, method: request.method(),
          headers: { ...headers, host: url.host },
        }, async response => {
          const parts = [];
          for await (const part of response) parts.push(part);
          const { connection, 'transfer-encoding': _transfer, ...responseHeaders } = response.headers;
          resolve({ status: response.statusCode, headers: responseHeaders, body: Buffer.concat(parts) });
        });
        upstream.on('error', reject);
        upstream.end(request.postDataBuffer());
      });
      // O Playwright segue redirecionamentos de fulfill fora da interceptação.
      if (request.method() === 'POST' && url.pathname.endsWith('/login') && result.status === 303) {
        assert.equal(result.headers.location, '/ana-dev/');
        result.status = 200;
        delete result.headers.location;
      }
      await route.fulfill(result);
    });
    const page = await context.newPage();
    await page.goto(origin + '/ana-dev/login');
    await page.getByLabel('Senha de acesso').fill(password);
    const signedIn = page.waitForResponse(response => response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Entrar' }).click();
    assert.equal((await signedIn).status(), 200);
    await page.goto(origin + '/ana-dev/');
    await page.getByText('Agenda sincronizada').waitFor();
    return page;
  }
  const pc = await connect(desktop);
  const phone = await connect(mobile);
  assert.equal(snapshot.payload.appointments.length, 83);
  assert.equal(snapshot.payload.clients.length, 20);
  const openChat = page => page.getByRole('button', { name: 'Abrir chat dos agentes' }).click();
  async function ask(page, text) {
    await page.getByRole('textbox', { name: 'Pergunta' }).fill(text);
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  }
  await openChat(phone);
  for (const viewport of [{ width: 320, height: 640 }, { width: 360, height: 720 },
    { width: 390, height: 750 }, { width: 720, height: 320 }, { width: 390, height: 320 }]) {
    await phone.setViewportSize(viewport);
    await phone.getByRole('textbox', { name: 'Pergunta' }).focus();
    const fits = await phone.evaluate(() => {
      const dialog = document.getElementById('agent-chat');
      const send = document.getElementById('agent-chat-send').getBoundingClientRect();
      return dialog.scrollWidth <= dialog.clientWidth && send.right <= visualViewport.width + 1 &&
        send.bottom <= visualViewport.offsetTop + visualViewport.height + 1;
    });
    assert.ok(fits, JSON.stringify(viewport));
  }
  await phone.setViewportSize({ width: 390, height: 750 });
  await phone.getByRole('button', { name: 'Fin', exact: true }).click();
  await ask(phone, 'Consultar Fin');
  await phone.getByText('Resultado: 320000').waitFor();
  await phone.getByRole('button', { name: 'Ana', exact: true }).click();
  await openChat(pc);
  assert.ok(await pc.evaluate(() => {
    const calendar = document.getElementById('calendar').getBoundingClientRect();
    const chat = document.getElementById('agent-chat').getBoundingClientRect();
    return calendar.right <= chat.left + 1 && chat.right <= innerWidth;
  }));
  await Promise.all([ask(phone, 'Geraldinho Teste'), ask(pc, 'Outro Teste')]);
  await Promise.all([phone, pc].map(page => page.locator('[data-role="assistant"]').last().waitFor()));
  assert.equal(snapshot.payload.appointments.length, 84);
  const booked = snapshot.payload.appointments.at(-1);
  assert.equal(booked.value, 200);
  const winner = (await phone.getByText('Ver na Agenda').isVisible()) ? phone : pc;
  const loser = winner === phone ? pc : phone;
  await loser.getByText(/horário está ocupado/).waitFor();
  await winner.getByRole('button', { name: 'Ver na Agenda' }).click();
  await winner.locator('#appointment-dialog[open]').waitFor();
  assert.equal(await winner.locator('#appointment-id').inputValue(), booked.id);
  await winner.locator('#financial-status').selectOption('Pago');
  await winner.locator('#payment-date').fill('2026-11-07');
  await winner.locator('#payment-form button[type="submit"]').click();
  await winner.locator('#appointment-form button[type="submit"]').click();
  await winner.locator('#appointment-dialog').waitFor({ state: 'hidden' });
  assert.equal(snapshot.payload.appointments.find(item => item.id === booked.id).financialStatus, 'Pago');
  await loser.getByRole('button', { name: 'Fin', exact: true }).click();
  await ask(loser, 'Consultar Fin');
  await loser.getByText('Resultado: 340000').waitFor();
  const polled = lightweightReads;
  await loser.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await loser.waitForTimeout(100);
  assert.ok(lightweightReads > polled);
  const beforeOffline = snapshot.revision;
  await loser.context().setOffline(true);
  await loser.getByRole('button', { name: 'Fechar chat' }).click();
  await loser.getByRole('button', { name: 'Clientes', exact: true }).click();
  await loser.locator('#new-client').click();
  await loser.locator('#client-name').fill('Cliente Offline');
  await loser.locator('#client-form button[type="submit"]').click();
  await loser.getByText('Conecte-se e aguarde a Agenda carregar para salvar.').waitFor();
  assert.equal(snapshot.revision, beforeOffline);
  await loser.context().setOffline(false);
  await winner.reload();
  await winner.getByText('Agenda sincronizada').waitFor();
  assert.equal(snapshot.payload.appointments.length, 84);
  await openChat(winner);
  await ask(winner, 'Agendar série');
  await winner.getByText(/Série agendada/).waitFor();
  assert.equal(snapshot.payload.appointments.length, 86);
  await ask(winner, 'Apagar série');
  const confirm = winner.getByRole('button', { name: 'Confirmar exclusão' });
  await confirm.waitFor();
  assert.equal(snapshot.payload.appointments.length, 86);
  await confirm.click();
  await winner.getByText('2 atendimentos apagados da Agenda.').waitFor();
  assert.equal(snapshot.payload.appointments.length, 84);
  const modelBeforeBatch = modelRequests;
  await ask(winner, 'Apague os atendimentos não pagos de novembro de 2026');
  await winner.getByText('67 atendimentos · 0 com pagamento registrado').waitFor();
  const versionBeforeYes = snapshot.revision;
  await ask(winner, 'Sim');
  await winner.getByText('Toque em Confirmar exclusão no cartão acima.').waitFor();
  assert.equal(snapshot.revision, versionBeforeYes);
  assert.equal(modelRequests, modelBeforeBatch);
  await winner.getByRole('button', { name: 'Confirmar exclusão' }).click();
  await winner.getByText('67 atendimentos apagados da Agenda.').waitFor();
  assert.equal(snapshot.payload.appointments.length, 17);
  await winner.context().clearCookies();
  await ask(winner, 'Consultar sessão expirada');
  await winner.getByText('Entrar novamente em outra aba').waitFor();
  assert.equal(await winner.getByRole('textbox', { name: 'Pergunta' }).inputValue(), 'Consultar sessão expirada');
  console.log('Dois perfis passaram por login, disputa de horário, pagamento compartilhado, modo offline e sessão expirada.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
