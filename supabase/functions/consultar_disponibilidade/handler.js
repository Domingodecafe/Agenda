const PROJECT_URL = 'https://dpdxzbbzymkygutwefww.supabase.co';
const DAY = 86400000;
const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const response = (status, data) => new Response(JSON.stringify(data), { status, headers: HEADERS });
const error = (status, code) => response(status, { erro: code });
function date(value) {
  if (typeof value !== 'string' || !/^(19|20|21)\d{2}-\d{2}-\d{2}$/.test(value) || value > '2100-12-31') throw new Error('date');
  const parsed = new Date(value + 'T12:00:00Z');
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('date');
  return value;
}
export function parsePeriod(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('body');
  const keys = Object.keys(body).sort().join(',');
  let start, end;
  if (keys === 'data') start = end = date(body.data);
  else if (keys === 'data_fim,data_inicio') { start = date(body.data_inicio); end = date(body.data_fim); }
  else throw new Error('fields'); // Nunca aceita owner_id/user_id/agenda/payload.
  if (end < start || (Date.parse(end) - Date.parse(start)) / DAY > 30) throw new Error('period');
  return { start, end };
}
async function readBody(request) {
  if (!request.body) throw new Error('body');
  const reader = request.body.getReader(); const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > 2048) { await reader.cancel(); throw new Error('large'); }
    chunks.push(value);
  }
  const all = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(all));
}
// Lista positiva: mesmo uma futura alteração no RPC não pode vazar campos extras.
export function projectAvailability(raw, period) {
  if (!raw || !Number.isSafeInteger(raw.revisao) || raw.revisao < 1 || !Array.isArray(raw.dias)) throw new Error('source');
  const expected = Math.round((Date.parse(period.end)-Date.parse(period.start))/DAY)+1;
  if (raw.dias.length !== expected) throw new Error('source');
  const days = raw.dias.map((day,index) => {
    const expectedDate = new Date(Date.parse(period.start)+index*DAY).toISOString().slice(0,10);
    if (day.data !== expectedDate || !Array.isArray(day.horarios) || day.horarios.length > 9) throw new Error('source');
    const slots = day.horarios.map(slot => {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.inicio) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.fim)) throw new Error('source');
      const start = new Date(slot.inicio_utc), end = new Date(slot.fim_utc);
      if (Number.isNaN(start.getTime()) || end-start !== 3600000) throw new Error('source');
      return { inicio: slot.inicio, fim: slot.fim, inicio_utc: start.toISOString(), fim_utc: end.toISOString() };
    });
    return { data: expectedDate, horarios: slots };
  });
  return { ambiente: 'ana-dev', fuso_horario: 'America/Sao_Paulo', duracao_minutos: 60,
    data_inicio: period.start, data_fim: period.end, revisao: raw.revisao, dias: days };
}
export function createHandler({ projectUrl, publicKey, fetchImpl = fetch }) {
  return async request => {
    if (request.method !== 'POST') return error(405, 'METODO_NAO_PERMITIDO');
    const auth = request.headers.get('Authorization');
    if (!auth || !/^Bearer [A-Za-z0-9_.-]+$/.test(auth)) return error(401, 'NAO_AUTORIZADO');
    if (projectUrl !== PROJECT_URL || !publicKey) return error(503, 'SERVICO_INDISPONIVEL');
    const headers = { apikey: publicKey, Authorization: auth, 'Content-Type': 'application/json' };
    try {
      const verified = await fetchImpl(projectUrl + '/auth/v1/user', { headers, signal: AbortSignal.timeout(8000) });
      if (verified.status >= 500) return error(503, 'AUTENTICACAO_INDISPONIVEL');
      if (!verified.ok) return error(401, 'NAO_AUTORIZADO');
      const user = await verified.json();
      if (!user?.id || user.is_anonymous === true) return error(401, 'NAO_AUTORIZADO');
    } catch { return error(503, 'AUTENTICACAO_INDISPONIVEL'); }
    if (new URL(request.url).search) return error(400, 'CONSULTA_INVALIDA');
    if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) return error(415, 'JSON_OBRIGATORIO');
    let period;
    try { period = parsePeriod(await readBody(request)); }
    catch (cause) { return error(cause.message === 'large' ? 413 : 400, 'CONSULTA_INVALIDA'); }
    try {
      const result = await fetchImpl(projectUrl + '/rest/v1/rpc/consultar_disponibilidade', {
        method: 'POST', headers, body: JSON.stringify({ p_inicio: period.start, p_fim: period.end }), signal: AbortSignal.timeout(8000),
      });
      if (!result.ok) return error(result.status === 401 || result.status === 403 ? 403 : 503,
        result.status === 401 || result.status === 403 ? 'NAO_AUTORIZADO' : 'DISPONIBILIDADE_INDISPONIVEL');
      return response(200, projectAvailability(await result.json(), period));
    } catch { return error(503, 'DISPONIBILIDADE_INDISPONIVEL'); }
  };
}
