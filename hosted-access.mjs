import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const cookie = 'agenda_dev_session';
const duration = 12 * 60 * 60;
const digest = value => createHash('sha256').update(value).digest();
const page = `<!doctype html><html lang="pt-BR"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Agenda DEV · Acesso privado</title>
<style>body{color-scheme:light dark;font:1rem system-ui;margin:12vh auto;padding:0 20px;max-width:28rem}input,button{font:inherit;padding:.7rem;margin-top:.45rem}input{width:100%;box-sizing:border-box}</style>
<main><h1>Agenda DEV</h1><p>Ambiente privado para testes com dados fictícios.</p>
<form action="/ana-dev/login" method="post"><label>Senha de acesso<input name="password" type="password" autocomplete="current-password" required maxlength="256"></label><button>Entrar</button></form></main></html>`;

export function hostedAccess({ origin, password }) {
  const expected = digest(password);
  const sign = expiry => createHmac('sha256', password).update(`agenda-dev:${origin}:${expiry}`).digest('hex');
  let attempts = 0;
  let retryAfter = 0;
  return async (req, res, path) => {
    const isChat = path === '/ana-dev/api/chat';
    // O formulário precisa enviar Origin no POST, sem enviar referência a outros sites.
    if (path === '/ana-dev/login') res.setHeader('Referrer-Policy', 'same-origin');
    const value = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(cookie + '='))?.slice(cookie.length + 1);
    const [expiry, signature] = value?.split('.') ?? [];
    const authenticated = /^\d{10}$/.test(expiry || '') && Number(expiry) > Math.floor(Date.now() / 1000) &&
      /^[0-9a-f]{64}$/.test(signature || '') && timingSafeEqual(Buffer.from(signature), Buffer.from(sign(expiry)));
    if (path === '/ana-dev/login' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page);
      return false;
    }
    if (path === '/ana-dev/login' && req.method === 'POST') {
      if (req.headers.origin !== origin || !req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) {
        res.writeHead(403).end();
        return false;
      }
      const now = Date.now();
      if (now >= retryAfter) { attempts = 0; retryAfter = now + 60000; }
      if (attempts >= 10) {
        res.writeHead(429, { 'Retry-After': '60', 'Content-Type': 'text/plain; charset=utf-8' }).end('Tente novamente em um minuto.');
        return false;
      }
      attempts++;
      const chunks = [];
      let length = 0;
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        length += chunk.length;
        if (length > 2048) {
          req.resume();
          res.writeHead(413).end();
          return false;
        }
        chunks.push(chunk);
      }
      const candidate = new URLSearchParams(Buffer.concat(chunks).toString('utf8')).get('password') || '';
      if (!timingSafeEqual(digest(candidate), expected)) {
        res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' })
          .end(page.replace('<form', '<p>Senha incorreta. Tente novamente.</p><form'));
        return false;
      }
      attempts = 0;
      const expires = Math.floor(Date.now() / 1000) + duration;
      res.writeHead(303, {
        Location: '/ana-dev/',
        'Set-Cookie': `${cookie}=${expires}.${sign(expires)}; Max-Age=${duration}; Path=/ana-dev/; HttpOnly; Secure; SameSite=Strict`,
      }).end();
      return false;
    }
    if (authenticated) return true;
    if (isChat) res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' })
      .end(JSON.stringify({ error: 'Sua sessão terminou. Recarregue a Agenda e entre novamente.' }));
    else if (path === '/' || path === '/ana-dev/' || path.endsWith('.html')) res.writeHead(303, { Location: '/ana-dev/login' }).end();
    else res.writeHead(401).end();
    return false;
  };
}
