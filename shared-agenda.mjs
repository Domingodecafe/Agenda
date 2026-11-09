import { createHash, randomUUID } from 'node:crypto';
import './ana-policy.js';
import './fin-core.js';
import './agent-chat.js';
import { createFixture } from './hosted-fixture.mjs';
import { prepareSeries, prepareChange } from './ana-agenda-actions.mjs';
import { prepareBulkRemoval } from './ana-bulk-removal.mjs';
import { readBody } from './agent-chat-server.mjs';

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
  const queue = state => state.anaQueue || [];
  const statusAt = (item, time) => item.status === 'pending' && item.expiresAt <= time ? 'expired' : item.status;
  const selectRemoval = (state, selection) => selection.filters
    ? prepareBulkRemoval(state, selection.filters, selection.within && new Set(selection.within))
    : prepareChange(state, selection.request, now());
  const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]))
    : item);
  function fingerprint(state, ids) {
    const wanted = new Set(ids);
    const names = new Map(state.clients.map(client => [client.id, client.name]));
    const items = state.appointments.filter(item => wanted.has(item.id)).sort((a, b) => a.id.localeCompare(b.id));
    return createHash('sha256').update(canonical(items.map(item => [item, names.get(item.clientId)]))).digest('hex');
  }
  function approval(state, selection, source, removal, review, time) {
    const names = new Map(state.clients.map(client => [client.id, client.name]));
    const ids = new Set(removal);
    const items = state.appointments.filter(item => ids.has(item.id));
    return {
      id: randomUUID(), kind: 'approval', title: 'Excluir atendimentos', status: 'pending', source,
      createdAt: time, expiresAt: time + 24 * 60 * 60 * 1000, selection, fingerprint: fingerprint(state, removal),
      review: review || {
        scope: 'Exclusão de atendimentos',
        paid: items.filter(item => item.financialStatus === 'Pago' || item.payment).length,
        items: items.map(item => `${item.date.split('-').reverse().join('/')} às ${item.start} · ${names.get(item.clientId) || item.clientName || 'Atendimento'}`),
      },
    };
  }
  function stillMatches(state, item, removal) {
    return removal?.length === item.review.items.length && fingerprint(state, removal) === item.fingerprint;
  }
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
    state = { ...state, settings: { ...state.settings, sharedFixture: marker } };
    delete state.anaQueue;
    if (current.state.anaQueue) state.anaQueue = current.state.anaQueue;
    return { revision: await store.write(revision, state), state };
  }

  async function modify(prepare, selection, source = 'text') {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { state, revision } = await read();
      const { state: next, removal, ...result } = prepare(state);
      const item = removal && approval(state, selection, source, removal, result.review, now().getTime());
      if (!next && !item) return result;
      try {
        await store.write(revision, next || { ...state, anaQueue: [item, ...queue(state)] });
        return item ? { ...result, review: item.review, confirmation: item.id } : result;
      } catch (error) {
        if (!(error instanceof AgendaConflict)) throw error;
      }
    }
    throw new AgendaConflict();
  }

  async function decide(id, action) {
    return modify(state => {
      const item = queue(state).find(entry => entry.id === id);
      const time = now().getTime();
      const status = item && statusAt(item, time);
      if (!item || status === 'expired' || status === 'superseded') {
        return { reply: 'A confirmação expirou. Peça a exclusão novamente para revisar.' };
      }
      if (status !== 'pending') return { reply: 'Este pedido já foi processado.' };
      if ((item.kind === 'notice') !== (action === 'resolve')) return { reply: 'Ação indisponível para este pedido.' };
      let appointments = state.appointments;
      let nextStatus = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'resolved';
      let reply = action === 'reject' ? 'Pedido recusado.' : 'Aviso resolvido.';
      if (action === 'approve') {
        const { removal } = selectRemoval(state, item.selection);
        if (stillMatches(state, item, removal)) {
          const ids = new Set(removal);
          appointments = appointments.filter(entry => !ids.has(entry.id));
          reply = `${ids.size} ${ids.size === 1 ? 'atendimento apagado' : 'atendimentos apagados'} da Agenda.`;
        } else {
          nextStatus = 'stale';
          reply = 'A Agenda mudou desde a revisão. Peça a exclusão novamente para conferir os registros.';
        }
      }
      return {
        state: { ...state, appointments, anaQueue: queue(state).map(entry =>
          entry.id === id ? { ...entry, status: nextStatus, decidedAt: time } : entry) },
        changed: nextStatus === 'approved',
        reply,
      };
    });
  }

  return {
    read, write, decide,
    async listQueue() {
      const time = now().getTime();
      return queue((await read()).state).map(({ selection, fingerprint, ...item }) =>
        ({ ...item, status: statusAt(item, time) }));
    },
    async consult(agent, period, filters) {
      return AgentChat.consult(agent, period, (await read()).state, now(), filters);
    },
    book: request => modify(state => {
      const result = prepareSeries(state, request, now());
      return result.state ? { ...result, changed: true } : result;
    }),
    change: (request, source) => modify(state => {
      const result = prepareChange(state, request, now());
      return result.state ? { ...result, changed: true } : result;
    }, { request }, source),
    bulkRemoval: (filters, source) => modify(state => prepareBulkRemoval(state, filters), { filters }, source),
    addNotice: (title, summary, source) => modify(state => ({
      state: { ...state, anaQueue: [{
        id: randomUUID(), kind: 'notice', status: 'pending', title, summary, source, createdAt: now().getTime(),
      }, ...queue(state)] },
      reply: 'Registrei o aviso na Central da Ana.',
    })),
    async continueRemoval(token, recurringOnly, source = 'text') {
      return modify(state => {
        const item = queue(state).find(entry => entry.id === token && entry.kind === 'approval');
        const time = now().getTime();
        if (!item || statusAt(item, time) !== 'pending') {
          return { reply: 'A revisão expirou. Peça a exclusão novamente.', discardConfirmation: true };
        }
        const { removal } = selectRemoval(state, item.selection);
        if (!stillMatches(state, item, removal)) {
          return { reply: 'A Agenda mudou desde a revisão. Peça a exclusão novamente.', discardConfirmation: true };
        }
        if (!recurringOnly || !item.selection.filters) {
          return { reply: 'Toque em Confirmar exclusão no cartão ou na Central da Ana.', showConfirmation: true };
        }
        const selection = { filters: { ...item.selection.filters, recurrence: 'series' }, within: removal };
        const result = selectRemoval(state, selection);
        if (!result.removal) return { reply: result.reply, showConfirmation: true };
        const next = approval(state, selection, source, result.removal, result.review, time);
        return {
          state: { ...state, anaQueue: [next, ...queue(state).map(entry => entry.id === token
            ? { ...entry, status: 'superseded', decidedAt: time } : entry)] },
          reply: result.reply, review: next.review, confirmation: next.id, discardConfirmation: true,
        };
      });
    },
    confirmRemoval: token => decide(token, 'approve'),
  };
}

export function sharedAgendaHandler(agenda, origin) {
  const publicResult = ({ revision, state: { anaQueue, ...state } }) => ({ revision, state });
  return async (req, res, url) => {
    const send = (status, payload) => res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(payload));
    try {
      if (req.method === 'GET') {
        const revision = Number(url.searchParams.get('revision'));
        const result = await agenda.read(revision);
        return result ? send(200, publicResult(result)) : res.writeHead(304).end();
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
      return send(200, publicResult(await agenda.write(data?.revision, data?.state)));
    } catch (error) {
      if (error instanceof AgendaConflict) return send(409, { error: 'A Agenda mudou em outro aparelho. Confira os dados atualizados e tente novamente.' });
      if (error instanceof TypeError && error.message === 'Alteração inválida.') return send(400, { error: error.message });
      return send(503, { error: 'Não foi possível conectar à agenda compartilhada. Tente novamente.' });
    }
  };
}

export function anaQueueHandler(agenda, origin) {
  return async (req, res) => {
    const send = (status, payload) => res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    }).end(JSON.stringify(payload));
    try {
      if (req.method === 'GET') return send(200, { items: await agenda.listQueue() });
      if (req.method !== 'POST') return send(405, { error: 'Método inválido.' });
      if (req.headers.origin !== origin || !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
        return send(403, { error: 'Abra a Central da Ana para decidir.' });
      }
      const body = await readBody(req);
      if (!safeId(body?.id) || !['approve', 'reject', 'resolve'].includes(body?.action)) {
        return send(400, { error: 'Decisão inválida.' });
      }
      return send(200, await agenda.decide(body.id, body.action));
    } catch (error) {
      if (error.status === 400 || error.status === 413) return send(error.status, { error: error.message });
      if (error instanceof AgendaConflict) return send(409, { error: 'A Agenda foi atualizada. Tente novamente.' });
      return send(503, { error: 'Não foi possível acessar a Central da Ana. Tente novamente.' });
    }
  };
}
