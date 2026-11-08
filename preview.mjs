import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createAgentChat } from './agent-chat-server.mjs';
import { createVoiceHandler } from './agent-voice-server.mjs';
import { hostedAccess } from './hosted-access.mjs';
import { createFixture } from './hosted-fixture.mjs';
import { createSharedAgenda, createSnapshotStore, sharedAgendaHandler } from './shared-agenda.mjs';

// Somente os arquivos públicos da PWA: não expõe Git, SQL, backups ou configurações.
const files = new Map([
  ['/index.html', 'text/html; charset=utf-8'],
  ['/app.js', 'text/javascript; charset=utf-8'],
  ['/agent-chat.js', 'text/javascript; charset=utf-8'],
  ['/agent-chat.css', 'text/css; charset=utf-8'],
  ['/agent-voice.js', 'text/javascript; charset=utf-8'],
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
  ['/aquarela.css', 'text/css; charset=utf-8'],
  ['/graphite.css', 'text/css; charset=utf-8'],
  ['/styles.css', 'text/css; charset=utf-8'],
  ['/manifest.webmanifest', 'application/manifest+json'],
  ['/icon.svg', 'image/svg+xml'],
]);
const hostedOrigin = (process.env.AGENDA_DEV_ORIGIN || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/$/, '');
if (process.env.RENDER === 'true' && !hostedOrigin) {
  throw new Error('O Render não forneceu RENDER_EXTERNAL_URL. Configure AGENDA_DEV_ORIGIN com o endereço HTTPS do serviço.');
}
const port = hostedOrigin ? Number(process.env.PORT || 10000) : 43188;
const host = hostedOrigin ? '0.0.0.0' : '127.0.0.1';
const basePath = '/ana-dev/';
const url = URL.parse(hostedOrigin || `http://${host}:${port}`);
const password = process.env.AGENDA_DEV_PASSWORD;
const apiKey = process.env.OPENAI_API_KEY?.trim();
const model = process.env.OPENAI_MODEL?.trim();
const sharedEnabled = process.env.AGENDA_SHARED === 'true';
const voiceModel = process.env.OPENAI_REALTIME_MODEL?.trim();
const voiceEnabled = Boolean(hostedOrigin && sharedEnabled && voiceModel && process.env.AGENDA_VOICE === 'true');
const supabase = {
  url: process.env.AGENDA_SUPABASE_URL?.trim().replace(/\/$/, ''),
  key: process.env.AGENDA_SUPABASE_PUBLISHABLE_KEY?.trim(),
  email: process.env.AGENDA_SUPABASE_EMAIL?.trim(),
  password: process.env.AGENDA_SUPABASE_PASSWORD,
};
if (sharedEnabled) {
  const problems = [];
  if (!hostedOrigin) problems.push('RENDER_EXTERNAL_URL ausente');
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(supabase.url || '')) problems.push('AGENDA_SUPABASE_URL deve ser a URL HTTPS do projeto, sem caminho');
  if (!supabase.key?.startsWith('sb_publishable_')) problems.push('AGENDA_SUPABASE_PUBLISHABLE_KEY ausente ou não começa com sb_publishable_');
  if (!supabase.email) problems.push('AGENDA_SUPABASE_EMAIL está vazio ou ausente');
  if (!supabase.password?.trim()) problems.push('AGENDA_SUPABASE_PASSWORD está vazia ou ausente');
  if (problems.length) throw new Error('Configuração da Agenda compartilhada: ' + problems.join(' | '));
}
if (hostedOrigin) {
  const problems = [];
  if (url?.protocol !== 'https:' || url.origin !== hostedOrigin) problems.push('AGENDA_DEV_ORIGIN ou RENDER_EXTERNAL_URL deve ser um endereço HTTPS sem caminho');
  if (!password || password.trim().length < 16 || password.length > 256) problems.push('AGENDA_DEV_PASSWORD deve ter de 16 a 256 caracteres');
  if (!apiKey) problems.push('OPENAI_API_KEY está vazia ou ausente');
  if (!model) problems.push('OPENAI_MODEL está vazio ou ausente');
  if (problems.length) throw new Error('Configuração da Agenda DEV: ' + problems.join(' | '));
}
const access = hostedOrigin ? hostedAccess({ origin: url.origin, password }) : null;
const agenda = sharedEnabled ? createSharedAgenda(createSnapshotStore(supabase)) : null;
const agendaApi = agenda ? sharedAgendaHandler(agenda, url.origin) : null;
const browserConfig = hostedOrigin ? `globalThis.AgendaHostedConfig = ${JSON.stringify({
  origin: url.origin, shared: sharedEnabled, voice: voiceEnabled, ...(sharedEnabled ? {} : { fixture: createFixture() }),
})};\n` : '';
const agentChat = createAgentChat({
  origin: url.origin,
  apiKey,
  model,
  agenda,
});
const voice = voiceEnabled ? createVoiceHandler({
  origin: url.origin, apiKey, model: voiceModel, processTurn: agentChat.processTurn,
  metric: data => console.info(JSON.stringify(data)),
}) : null;
export const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  if (access && req.url === '/healthz' && req.method === 'GET') {
    const revision = process.env.RENDER_GIT_COMMIT;
    if (/^[a-f0-9]{40}$/.test(revision || '')) res.setHeader('X-Agenda-Commit', revision);
    res.writeHead(200).end('ok');
    return;
  }
  if (req.headers.host !== url.host) {
    res.writeHead(403).end(); return;
  }
  let requestUrl;
  try { requestUrl = new URL(req.url, url); }
  catch { res.writeHead(400).end(); return; }
  const { pathname } = requestUrl;
  if (access) {
    try { if (!await access(req, res, pathname)) return; }
    catch { if (!res.headersSent) res.writeHead(400); res.end(); return; }
  }
  if (pathname === basePath + 'api/chat') return agentChat(req, res);
  const voicePath = basePath + 'api/voice';
  if (voice && (pathname === voicePath || pathname.startsWith(voicePath + '/'))) {
    return voice(req, res, pathname.slice(voicePath.length + 1));
  }
  if (agendaApi && pathname === basePath + 'api/agenda') return agendaApi(req, res, requestUrl);
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
