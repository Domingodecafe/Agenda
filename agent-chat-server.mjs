import { randomUUID } from 'node:crypto';

const tools = {
  ana: { name: 'consultar_horarios', field: 'data', format: 'AAAA-MM-DD', description: 'Consulta horários livres para um dia.' },
  fin: { name: 'consultar_recebimentos', field: 'mes', format: 'AAAA-MM', description: 'Consulta o total recebido em um mês.' },
};
const month = /^\d{4}-(0[1-9]|1[0-2])$/;
const time = /^([01]\d|2[0-3]):00$/;
const bookingTool = {
  type: 'function', name: 'agendar_atendimento', strict: true,
  description: 'Grava uma sessão de 60 minutos por R$ 200 na Agenda DEV. Use somente quando o usuário pedir explicitamente para agendar.',
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      nome: { type: 'string', description: 'Nome do cliente informado pelo usuário.' },
      data: { type: 'string', description: 'Data no formato AAAA-MM-DD.' },
      horario: { type: 'string', description: 'Início no formato HH:MM (horário de São Paulo).' },
      modalidade: { type: ['string', 'null'], enum: ['Presencial', 'Online', null] },
    },
    required: ['nome', 'data', 'horario', 'modalidade'],
  },
};
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const validText = (value, max) => typeof value === 'string' && value.length <= max && value.trim().length > 0;
const answer = output => output.flatMap(item => item.type === 'message' ? item.content : [])
  .find(item => item.type === 'output_text')?.text?.trim();

class ChatError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 24 * 1024) {
      req.resume();
      throw new ChatError(413, 'Mensagem grande demais.');
    }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ChatError(400, 'Mensagem inválida.'); }
}

export function createAgentChat({ origin, apiKey, model, fetchResponse = fetch }) {
  const pending = new Map();
  let active = 0;

  async function respond(input, instructions, options) {
    let response;
    try {
      response = await fetchResponse('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input, instructions, store: false, max_output_tokens: 800, ...options }),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new ChatError(503, 'Sem conexão com a OpenAI ou tempo de resposta esgotado.');
    }
    if (response.status === 401 || response.status === 403) throw new ChatError(503, 'Confira a chave e o acesso ao modelo da OpenAI.');
    if (response.status === 429) throw new ChatError(503, 'A OpenAI atingiu um limite de uso. Verifique a conta e tente novamente.');
    if (!response.ok) throw new ChatError(502, 'A OpenAI recusou a consulta. Confira o modelo configurado e tente novamente.');
    const data = await response.json();
    if (data.status !== 'completed' || !Array.isArray(data.output)) throw new ChatError(502, 'A OpenAI não concluiu a resposta.');
    return data.output;
  }

  async function start(body) {
    const { agent, message, history } = body;
    if (!Object.hasOwn(tools, agent) || !validText(message, 1000) || !Array.isArray(history) || history.length > 12 ||
        !history.every(item => ['user', 'assistant'].includes(item?.role) && validText(item.content, 1500))) {
      throw new ChatError(400, 'Conversa inválida.');
    }
    const tool = tools[agent];
    const now = new Date();
    const dateFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', dateStyle: 'short' });
    const today = dateFormat.format(now);
    const tomorrow = dateFormat.format(new Date(now.getTime() + 86400000));
    const instructions = [
      `Você é ${agent === 'ana' ? 'Ana, secretária' : 'Fin, assistente financeiro'} na Agenda DEV.`,
      `Hoje é ${today} e amanhã é ${tomorrow} em America/Sao_Paulo.`,
      'Responda em português do Brasil.',
      'Chame a ferramenta para perguntas que exigem dados da Agenda. Nunca invente horários ou valores.',
      agent === 'ana' ?
        'Ao receber um pedido explícito de agendamento, use agendar_atendimento assim que houver nome, data e hora. Aproveite informações anteriores do mesmo pedido. Pergunte somente o que faltar ou estiver ambíguo. A sessão tem 60 minutos, custa R$ 200 e é presencial se a modalidade não foi informada. Não peça confirmação. Não use agendar_atendimento para consultas, hipóteses ou pedidos de editar, remarcar, cancelar ou criar recorrência. Nunca diga que gravou: o aplicativo mostrará o resultado.' :
        'Você só consulta recebimentos. Recuse pedidos de criação, edição ou exclusão. Peça esclarecimento se faltar o mês.',
    ].join(' ');
    const input = [...history.map(({ role, content }) => ({ role, content })), { role: 'user', content: message }];
    const output = await respond(input, instructions, {
      tools: [{
        type: 'function', name: tool.name, description: tool.description, strict: true,
        parameters: {
          type: 'object', properties: { [tool.field]: { type: 'string', description: tool.format } },
          required: [tool.field], additionalProperties: false,
        },
      }, ...(agent === 'ana' ? [bookingTool] : [])],
      parallel_tool_calls: false,
      include: ['reasoning.encrypted_content'],
    });
    const calls = output.filter(item => item.type === 'function_call');
    if (!calls.length) {
      const reply = answer(output);
      if (!reply) throw new ChatError(502, 'O agente não retornou uma resposta.');
      return { reply };
    }
    const [call] = calls;
    if (calls.length !== 1 || !call.call_id) throw new ChatError(502, 'Ação do agente inválida.');
    let args;
    try { args = JSON.parse(call.arguments); }
    catch { throw new ChatError(502, 'Dados da ação inválidos.'); }
    if (agent === 'ana' && call.name === bookingTool.name) {
      const { nome, data, horario, modalidade } = args || {};
      if (!validText(nome, 100) || typeof data !== 'string' || !validDate(data) ||
          typeof horario !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(horario) ||
          ![null, 'Presencial', 'Online'].includes(modalidade)) {
        throw new ChatError(502, 'O agente não identificou dados válidos para o agendamento.');
      }
      return { booking: { name: nome.trim(), date: data, start: horario, modality: modalidade || 'Presencial' } };
    }
    if (call.name !== tool.name) throw new ChatError(502, 'Consulta do agente inválida.');
    const period = args?.[tool.field];
    if (typeof period !== 'string' || !(agent === 'ana' ? validDate(period) : month.test(period))) {
      throw new ChatError(502, 'Período da consulta inválido.');
    }
    if (pending.size >= 32) throw new ChatError(429, 'Há consultas demais em andamento. Tente novamente em instantes.');
    const id = randomUUID();
    const timer = setTimeout(() => pending.delete(id), 60000);
    timer.unref();
    pending.set(id, { agent, period, timer, input, output, instructions, callId: call.call_id });
    return { id, period };
  }

  async function finish({ id, result }) {
    const task = pending.get(id);
    if (!task) throw new ChatError(409, 'A consulta expirou. Envie a pergunta novamente.');
    const { agent, period, timer, input, output, instructions, callId } = task;
    let facts;
    if (agent === 'ana' && Array.isArray(result?.starts) && result.starts.length <= 24 &&
        result.starts.every(value => typeof value === 'string' && time.test(value))) {
      facts = { data: period, horarios: [...new Set(result.starts)].sort() };
    } else if (agent === 'fin' && Number.isSafeInteger(result?.receivedCents) && result.receivedCents >= 0) {
      facts = { mes: period, recebidoEmCentavos: result.receivedCents };
    } else {
      throw new ChatError(400, 'Resultado da consulta inválido.');
    }
    pending.delete(id);
    clearTimeout(timer);
    const final = await respond([
      ...input, ...output,
      { type: 'function_call_output', call_id: callId, output: JSON.stringify(facts) },
    ], instructions + ' Explique o resultado fornecido em texto curto. Use somente os fatos da ferramenta.');
    const reply = answer(final);
    if (!reply) throw new ChatError(502, 'O agente não retornou uma resposta.');
    return { reply };
  }

  return async (req, res) => {
    const send = (status, data) => res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(data));
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return send(405, { error: 'Método inválido.' });
    }
    if (req.headers.origin !== origin || !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
      return send(403, { error: 'Abra o chat pela Agenda DEV.' });
    }
    if (!apiKey || !model) return send(503, { error: 'Configure OPENAI_API_KEY e OPENAI_MODEL no servidor e reinicie a prévia.' });
    if (active >= 4) return send(429, { error: 'Há consultas demais em andamento. Tente novamente em instantes.' });
    active++;
    try {
      const body = await readBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ChatError(400, 'Mensagem inválida.');
      send(200, await (Object.hasOwn(body, 'id') ? finish(body) : start(body)));
    } catch (error) {
      if (error instanceof ChatError) send(error.status, { error: error.message });
      else send(502, { error: 'Não foi possível consultar o agente. Tente novamente.' });
    } finally {
      active--;
    }
  };
}
