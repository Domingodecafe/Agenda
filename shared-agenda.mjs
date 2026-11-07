import { randomUUID } from 'node:crypto';
import './ana-policy.js';
import './fin-core.js';
import './agent-chat.js';
import { createFixture } from './hosted-fixture.mjs';

export class AgendaConflict extends Error {}

export function createSnapshotStore({ url, key, email, password, fetcher = fetch }) {
  let session, authenticating;
  async function request(path, options = {}, token) {
    const response = await fetcher(url + path, {
      ...options, signal: AbortSignal.timeout(8000),
      headers: { apikey: key, 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) },
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      if (typeof data?.message === 'string' && data.message.startsWith('CONFLITO_REVISAO')) throw new AgendaConflict();
      throw new Error('Supabase indisponível ou configuração da agenda inválida.');
    }
    return data;
  }
  async function identity() {
    if (session && session.expires > Date.now() + 60000) return session;
    authenticating ||= request('/auth/v1/token?grant_type=password', {
      method: 'POST', body: JSON.stringify({ email, password }),
    }).then(data => {
      if (!data?.access_token || !data.user?.id || !Number.isFinite(data.expires_in)) throw new Error('Sessão inválida.');
      session = { token: data.access_token, owner: data.user.id, expires: Date.now() + data.expires_in * 1000 };
      return session;
    }).finally(() => { authenticating = undefined; });
    return authenticating;
  }
  return {
    async read(includePayload = true) {
      const { token, owner } = await identity();
      const query = new URLSearchParams({ owner_id: 'eq.' + owner, select: includePayload ? 'revision,payload' : 'revision', limit: '1' });
      const rows = await request('/rest/v1/agenda_snapshots?' + query, {}, token);
      if (!Array.isArray(rows)) throw new Error('Leitura da Agenda indisponível.');
      return rows[0] || null;
    },
    async write(revision, state) {
      const { token } = await identity();
      const next = await request('/rest/v1/rpc/write_agenda_snapshot', {
        method: 'POST', body: JSON.stringify({ p_expected_revision: revision, p_payload: state }),
      }, token);
      if (!Number.isSafeInteger(next) || next !== revision + 1) throw new Error('Revisão da Agenda inválida.');
      return next;
    },
  };
}

const marker = 'agenda-dev-v1';
const safeId = value => typeof value === 'string' && /^[\w-]{1,100}$/.test(value);
const slot = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const isSnapshot = state => state && Array.isArray(state.clients) && Array.isArray(state.appointments) &&
  state.settings && typeof state.settings === 'object' && !Array.isArray(state.settings) &&
  state.clients.every(item => safeId(item?.id) && typeof item.name === 'string') &&
  state.appointments.every(item => safeId(item?.id) && ['appointment', 'block'].includes(item.kind) &&
    FinCore.validDate(item.date) && slot(item.start) && slot(item.end) && item.start < item.end);

export function createSharedAgenda(store, { now = () => new Date() } = {}) {
  async function read(revision) {
    if (revision && (await store.read(false))?.revision === revision) return null;
    let snapshot = await store.read();
    if (!snapshot) {
      const fixture = createFixture();
      fixture.settings.sharedFixture = marker;
      try { snapshot = { revision: await store.write(0, fixture), payload: fixture }; }
      catch (error) {
        if (!(error instanceof AgendaConflict)) throw error;
        snapshot = await store.read();
      }
    }
    if (snapshot?.payload?.settings?.sharedFixture !== marker) throw new Error('A conta da Agenda DEV já tem outra base.');
    return { revision: snapshot.revision, state: snapshot.payload };
  }

  async function write(revision, state) {
    if (!Number.isSafeInteger(revision) || revision < 1 || !isSnapshot(state)) throw new TypeError('Alteração inválida.');
    const current = await read();
    if (current.revision !== revision) throw new AgendaConflict();
    state.settings.sharedFixture = marker;
    return { revision: await store.write(revision, state), state };
  }

  return {
    read,
    write,
    async consult(agent, period) {
      return AgentChat.consult(agent, period, (await read()).state, now());
    },
    async book(request) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const { state, revision } = await read();
        const booking = AgentChat.prepareBooking(state, request, now(), randomUUID);
        if (!booking.state) return { reply: booking.reply, details: booking.details };
        try {
          await store.write(revision, booking.state);
          return { reply: booking.reply, details: booking.details, appointment: booking.appointment };
        } catch (error) {
          if (!(error instanceof AgendaConflict)) throw error;
        }
      }
      throw new AgendaConflict();
    },
  };
}

export function sharedAgendaHandler(agenda, origin) {
  return async (req, res, url) => {
    const send = (status, payload) => res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(payload));
    try {
      if (req.method === 'GET') {
        const revision = Number(url.searchParams.get('revision'));
        const result = await agenda.read(revision);
        return result ? send(200, result) : res.writeHead(304).end();
      }
      if (req.method !== 'PUT') return send(405, { error: 'Método inválido.' });
      if (req.headers.origin !== origin || !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
        return send(403, { error: 'Abra a Agenda DEV para salvar.' });
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > 1024 * 1024) { req.resume(); return send(413, { error: 'Agenda grande demais para este ambiente.' }); }
        chunks.push(chunk);
      }
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return send(400, { error: 'Alteração inválida.' }); }
      return send(200, await agenda.write(data?.revision, data?.state));
    } catch (error) {
      if (error instanceof AgendaConflict) return send(409, { error: 'A Agenda mudou em outro aparelho. Confira os dados atualizados e tente novamente.' });
      if (error instanceof TypeError && error.message === 'Alteração inválida.') return send(400, { error: error.message });
      return send(503, { error: 'Não foi possível conectar à agenda compartilhada. Tente novamente.' });
    }
  };
}
