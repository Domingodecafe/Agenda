import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createAgentChat } from './agent-chat-server.mjs';
import { hostedAccess } from './hosted-access.mjs';
import { createFixture } from './hosted-fixture.mjs';

// Somente os arquivos públicos da PWA: não expõe Git, SQL, backups ou configurações.
const files = new Map([
  ['/index.html', 'text/html; charset=utf-8'],
  ['/app.js', 'text/javascript; charset=utf-8'],
  ['/agent-chat.js', 'text/javascript; charset=utf-8'],
  ['/agent-chat.css', 'text/css; charset=utf-8'],
  ['/cloud-sync.js', 'text/javascript; charset=utf-8'],
  ['/sw-ana-dev.js', 'text/javascript; charset=utf-8'],
  ['/ana-environment.js', 'text/javascript; charset=utf-8'],
  ['/ana-sync-engine.js', 'text/javascript; charset=utf-8'],
  ['/ana-console.html', 'text/html; charset=utf-8'],
  ['/ana-console.css', 'text/css; charset=utf-8'],
  ['/ana-console.js', 'text/javascript; charset=utf-8'],
  ['/ana-policy.js', 'text/javascript; charset=utf-8'],
  ['/ana-local-store.js', 'text/javascript; charset=utf-8'],
  ['/fin-console.html', 'text/html; charset=utf-8'],
  ['/fin-console.css', 'text/css; charset=utf-8'],
  ['/fin-console.js', 'text/javascript; charset=utf-8'],
  ['/fin-core.js', 'text/javascript; charset=utf-8'],
  ['/fin-ledger.js', 'text/javascript; charset=utf-8'],
  ['/fin-assistant.js', 'text/javascript; charset=utf-8'],
  ['/fin-store.js', 'text/javascript; charset=utf-8'],
  ['/verificar-isolamento.html', 'text/html; charset=utf-8'],
  ['/verificar-isolamento.js', 'text/javascript; charset=utf-8'],
  ['/styles.css', 'text/css; charset=utf-8'],
  ['/manifest.webmanifest', 'application/manifest+json'],
  ['/icon.svg', 'image/svg+xml'],
]);
const hostedOrigin = process.env.AGENDA_DEV_ORIGIN || process.env.RENDER_EXTERNAL_URL;
const port = hostedOrigin ? Number(process.env.PORT || 10000) : 43188;
const host = hostedOrigin ? '0.0.0.0' : '127.0.0.1';
const basePath = '/ana-dev/';
const url = new URL(hostedOrigin || `http://${host}:${port}`);
const password = process.env.AGENDA_DEV_PASSWORD;
if (hostedOrigin && (url.protocol !== 'https:' || url.origin !== hostedOrigin || !password || password.length < 16 ||
    !process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL)) {
  throw new Error('Agenda DEV online exige origem HTTPS, senha de pelo menos 16 caracteres e configuração da OpenAI.');
}
const access = hostedOrigin ? hostedAccess({ origin: url.origin, password }) : null;
const browserConfig = hostedOrigin ? `globalThis.AgendaHostedConfig = ${JSON.stringify({ origin: url.origin, fixture: createFixture() })};\n` : '';
const agentChat = createAgentChat({
  origin: url.origin,
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL,
});
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  if (access && req.url === '/healthz' && req.method === 'GET') { res.writeHead(200).end('ok'); return; }
  if (req.headers.host !== url.host) {
    res.writeHead(403).end(); return;
  }
  let pathname;
  try { pathname = new URL(req.url, url).pathname; }
  catch { res.writeHead(400).end(); return; }
  if (access) {
    try { if (!await access(req, res, pathname)) return; }
    catch { if (!res.headersSent) res.writeHead(400); res.end(); return; }
  }
  if (pathname === basePath + 'api/chat') return agentChat(req, res);
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return;
  }
  if (pathname === '/') {
    res.writeHead(302, { Location: basePath }).end(); return;
  }
  if (!pathname.startsWith(basePath)) { res.writeHead(404).end(); return; }
  const file = pathname === basePath ? '/index.html' : '/' + pathname.slice(basePath.length);
  if (!files.has(file)) { res.writeHead(404).end(); return; }
  if (file === '/sw-ana-dev.js') {
    if (access) { res.writeHead(404).end(); return; }
    res.setHeader('Service-Worker-Allowed', basePath);
  }
  try {
    const content = await readFile(new URL(`.${file}`, import.meta.url));
    res.writeHead(200, { 'Content-Type': files.get(file) });
    res.end(req.method === 'HEAD' ? undefined :
      file === '/ana-environment.js' && browserConfig ? browserConfig + content.toString('utf8') : content);
  } catch { res.writeHead(500).end('Falha ao abrir arquivo da prévia.'); }
});
server.on('error', error => {
  console.error(`Prévia não iniciada: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, host, () => {
  console.log(`Ana DEV: ${url.origin}${basePath}`);
  console.log('Use perfil de teste vazio e exclusivamente dados fictícios.');
  console.log('Ctrl+C para encerrar.');
});
