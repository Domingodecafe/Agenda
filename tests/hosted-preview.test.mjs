import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

test('Prévia hospedada protege a Agenda e o chat e fornece o cenário somente após login', async t => {
  const socket = net.createServer().listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const { port } = socket.address();
  await new Promise(resolve => socket.close(resolve));
  const origin = 'https://agenda-dev.example';
  const password = 'senha-exclusiva-de-teste';
  const server = spawn(process.execPath, [fileURLToPath(new URL('../preview.mjs', import.meta.url))], {
    env: { ...process.env, AGENDA_DEV_ORIGIN: origin + '/', PORT: String(port), AGENDA_DEV_PASSWORD: password,
      OPENAI_API_KEY: 'fake-key', OPENAI_MODEL: 'fake-model' },
  });
  t.after(() => server.kill());
  const ready = await Promise.race([once(server.stdout, 'data'), once(server, 'exit').then(() => [])]);
  assert.match(String(ready[0]), /Ana DEV:/);
  const request = (path, options = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method: options.method,
      headers: { Host: 'agenda-dev.example', ...options.headers } }, async res => {
      const chunks = [];
      for await (const chunk of res) chunks.push(chunk);
      resolve({ status: res.statusCode, headers: new Headers(res.headers), text: () => Buffer.concat(chunks).toString('utf8') });
    });
    req.on('error', reject);
    req.end(options.body?.toString());
  });
  assert.equal((await request('/healthz')).status, 200);
  assert.equal((await request('/ana-dev/')).headers.get('location'), '/ana-dev/login');
  assert.equal((await request('/ana-dev/login')).headers.get('referrer-policy'), 'same-origin');
  assert.equal((await request('/ana-dev/ana-environment.js')).status, 401);
  assert.equal((await request('/ana-dev/api/chat', { method: 'POST' })).status, 401);
  const login = (value, from = origin) => request('/ana-dev/login', {
    method: 'POST', headers: { Origin: from, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: value }),
  });
  assert.equal((await login(password, 'https://other.example')).status, 403);
  const wrongPassword = await login('incorrect');
  assert.equal(wrongPassword.status, 401);
  assert.equal(wrongPassword.headers.get('referrer-policy'), 'same-origin');
  const signedIn = await login(password);
  assert.equal(signedIn.status, 303);
  const cookie = signedIn.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
  const headers = { Cookie: cookie.split(';')[0] };
  assert.equal((await request('/ana-dev/', { headers })).status, 200);
  assert.equal((await request('/ana-dev/sw-ana-dev.js', { headers })).status, 404);
  assert.equal((await request('/ana-dev/hosted-access.mjs', { headers })).status, 404);
  const script = await (await request('/ana-dev/ana-environment.js', { headers })).text();
  assert.ok(!script.includes(password) && !script.includes('fake-key'));
  const context = vm.createContext({});
  vm.runInContext(script, context);
  assert.equal(context.AnaEnvironment.origin, origin);
  const { clients, appointments } = context.AgendaHostedConfig.fixture;
  assert.equal(clients.length, 20);
  assert.equal(appointments.length, 83);
  assert.equal(appointments.filter(a => a.financialStatus === 'Pago').reduce((n, a) => n + a.value, 0), 3200);
});

test('Inicialização lista configurações ausentes sem imprimir valores secretos', async () => {
  const secret = 'senha-curta';
  const server = spawn(process.execPath, [fileURLToPath(new URL('../preview.mjs', import.meta.url))], {
    env: { ...process.env, AGENDA_DEV_ORIGIN: 'https://agenda-dev.example', AGENDA_DEV_PASSWORD: secret,
      OPENAI_API_KEY: ' ', OPENAI_MODEL: '' },
  });
  let logs = '';
  server.stderr.setEncoding('utf8').on('data', chunk => { logs += chunk; });
  const [code] = await once(server, 'close');
  assert.equal(code, 1);
  assert.match(logs, /AGENDA_DEV_PASSWORD deve ter/);
  assert.match(logs, /OPENAI_API_KEY está vazia ou ausente/);
  assert.match(logs, /OPENAI_MODEL está vazio ou ausente/);
  assert.ok(!logs.includes(secret));
});
