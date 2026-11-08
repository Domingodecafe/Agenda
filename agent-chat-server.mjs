import { randomUUID } from 'node:crypto';
import { directRemoval, validRemovalFilters } from './ana-bulk-removal.mjs';

const tools = {
  ana: { name: 'consultar_horarios', field: 'data', format: 'AAAA-MM-DD', description: 'Consulta horários livres para um dia.' },
  fin: { name: 'consultar_recebimentos', field: 'mes', format: 'AAAA-MM', description: 'Consulta valores de atendimentos, pagamentos e pendências por mês e dia da semana.' },
};
const month = /^\d{4}-(0[1-9]|1[0-2])$/;
const finModes = ['total', 'open', 'received', 'both'];
const weekdays = ['domingos', 'segundas-feiras', 'terças-feiras', 'quartas-feiras', 'quintas-feiras', 'sextas-feiras', 'sábados'];
const finFields = {
  dia_da_semana: { type: ['integer', 'null'], enum: [null, 0, 1, 2, 3, 4, 5, 6], description: 'Domingo é 0, segunda é 1. Null para todos os dias.' },
  criterio: { type: 'string', enum: finModes },
};

function finReply(period, filters, result) {
  const { mode, weekday } = filters;
  const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(period + '-01T00:00:00Z'));
  const scope = weekday === null ? `em ${monthName}` : `nas ${weekdays[weekday]} de ${monthName}`;
  const money = cents => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const labels = { total: 'Total dos atendimentos', open: 'A receber pela data do atendimento', received: 'Recebido pela data do pagamento' };
  const fields = mode === 'both' ? ['received', 'open'] : [mode];
  for (const field of fields) {
    for (const suffix of ['Cents', 'Count']) {
      const value = result?.[field + suffix];
      if (!Number.isSafeInteger(value) || value < 0) throw new ChatError(400, 'Resultado da consulta inválido.');
    }
  }
  if (fields.every(field => result[field + 'Count'] === 0)) {
    return { reply: `${fields.map(field => labels[field]).join(' e ')} ${scope}: sem registros.` };
  }
  const values = fields.map(field => `${labels[field]}: ${money(result[field + 'Cents'])}`).join(' e ');
  return { reply: `${scope[0].toUpperCase() + scope.slice(1)}, ${values[0].toLowerCase() + values.slice(1)}.` };
}

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
const nullableText = description => ({ type: ['string', 'null'], description });
const recurringBookingTool = {
  ...bookingTool,
  description: 'Agenda uma sessão ou uma série quando o usuário pedir explicitamente.',
  parameters: {
    ...bookingTool.parameters,
    properties: {
      ...bookingTool.parameters.properties,
      frequencia: { type: 'string', enum: ['none', 'weekly', 'biweekly', 'monthly'] },
      quantidade: { type: ['integer', 'null'], description: 'Número de sessões se informado.' },
      ate: nullableText('Última data inclusiva AAAA-MM-DD se informada.'),
    },
    required: [...bookingTool.parameters.required, 'frequencia', 'quantidade', 'ate'],
  },
};
const changeFields = {
  acao: { type: 'string', enum: ['edit', 'cancel', 'delete'] },
  nome: { type: 'string', description: 'Nome do cliente identificado no pedido.' },
  data: nullableText('Data original AAAA-MM-DD.'),
  horario: nullableText('Horário original HH:MM.'),
  alcance: { type: ['string', 'null'], enum: ['single', 'future', 'series', null] },
  nova_data: nullableText('Nova data AAAA-MM-DD.'),
  novo_horario: nullableText('Novo início HH:MM.'),
  modalidade: { type: ['string', 'null'], enum: ['Presencial', 'Online', null] },
  valor: { type: ['number', 'null'], description: 'Novo valor em reais, se pedido.' },
  duracao: { type: ['integer', 'null'], description: 'Nova duração em minutos, se pedida.' },
};
const changeTool = {
  type: 'function', name: 'alterar_atendimento', strict: true,
  description: 'Edita, remarca, cancela ou prepara a exclusão de atendimentos existentes.',
  parameters: { type: 'object', additionalProperties: false, properties: changeFields, required: Object.keys(changeFields) },
};
const bulkFields = {
  names: { type: ['array', 'null'], items: { type: 'string' }, description: 'Nomes dos clientes citados. Null para todos.' },
  from: nullableText('Data inicial inclusiva AAAA-MM-DD. Null se não houver período.'),
  through: nullableText('Data final inclusiva AAAA-MM-DD. Null se não houver período.'),
  weekdays: { type: ['array', 'null'], items: { type: 'integer' }, description: 'Dias da semana de 0 (domingo) a 6 (sábado).' },
  start: nullableText('Hora inicial ou exata HH:MM.'),
  throughTime: nullableText('Hora final inclusiva HH:MM para intervalo.'),
  recurrence: { type: ['string', 'null'], enum: ['series', 'single', 'weekly', 'biweekly', 'monthly', null] },
  payment: { type: ['string', 'null'], enum: ['paid', 'unpaid', 'not_paid', null] },
};
const bulkTool = {
  type: 'function', name: 'revisar_exclusao_em_lote', strict: true,
  description: 'Monta o cartão de revisão para um pedido explícito de apagar vários atendimentos, combinando os filtros solicitados.',
  parameters: { type: 'object', additionalProperties: false, properties: bulkFields, required: Object.keys(bulkFields) },
};
const tokenPattern = /^[0-9a-f-]{36}$/;
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const validText = (value, max) => typeof value === 'string' && value.length <= max && value.trim().length > 0;
const answer = output => output.flatMap(item => item.type === 'message' ? item.content : [])
  .find(item => item.type === 'output_text')?.text?.trim();
const validStart = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const optionalDate = value => value == null || (typeof value === 'string' && validDate(value));
const cleanAnswer = output => {
  const reply = answer(output);
  if (!reply || /<\/?(?:commentary|analysis|function_call|tool_call)\b|\bto=functions\.|<\|[^>]+\|>/i.test(reply)) {
    throw new ChatError(502, 'O agente retornou uma resposta inválida. Sua pergunta foi preservada para tentar novamente.');
  }
  return reply;
};

class ChatError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function openAIError(response) {
  const payload = await response.json().catch(() => null);
  // Nunca repassa error.message, que pode incluir parte da chave ou dados do pedido.
  const code = payload?.error?.code;
  if (code === 'invalid_api_key') {
    return new ChatError(503, 'A OpenAI rejeitou a chave (invalid_api_key). Troque OPENAI_API_KEY no Render por uma chave ativa do projeto correto.');
  }
  if (code === 'model_not_found') {
    return new ChatError(503, 'O projeto da chave não tem acesso ao modelo configurado (model_not_found). Confira OPENAI_MODEL no Render e os modelos disponíveis no projeto da OpenAI.');
  }
  if (['insufficient_quota', 'credit_balance_exhausted', 'organization_usage_limit_exceeded',
    'organization_spend_limit_exceeded', 'project_spend_limit_exceeded'].includes(code)) {
    return new ChatError(503, `A OpenAI bloqueou a consulta por saldo ou limite de gastos (${code}). Confira a cobrança e os limites do projeto da chave.`);
  }
  if (response.status === 401) return new ChatError(503, 'A OpenAI recusou a autenticação (401). Confira a chave, o projeto e eventuais restrições de IP na OpenAI.');
  if (response.status === 403) return new ChatError(503, 'A OpenAI negou acesso (403). Confira se a chave tem permissão para usar a Responses API e o modelo no projeto.');
  if (response.status === 429) return new ChatError(503, 'A OpenAI atingiu um limite de uso (429). Verifique a conta e tente novamente.');
  return new ChatError(502, `A OpenAI recusou a consulta (${response.status}). Confira o modelo configurado e tente novamente.`);
}

export async function readBody(req) {
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

export function createAgentChat({ origin, apiKey, model, fetchResponse = fetch, agenda }) {
  const pending = new Map();
  let active = 0;

  async function respond(input, instructions, options, budget = 1600) {
    let response;
    try {
      response = await fetchResponse('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input, instructions, store: false, max_output_tokens: budget, ...options }),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new ChatError(503, 'Sem conexão com a OpenAI ou tempo de resposta esgotado.');
    }
    if (!response.ok) throw await openAIError(response);
    const data = await response.json();
    const reason = data.incomplete_details?.reason;
    if (data.status === 'incomplete' && reason === 'max_output_tokens' && budget === 1600) {
      return respond(input, instructions, options, 4800);
    }
    if (data.status !== 'completed' || !Array.isArray(data.output)) {
      const detail = reason === 'max_output_tokens' ? 'A resposta atingiu o limite de geração.' :
        reason === 'content_filter' ? 'A resposta foi interrompida pelo filtro da OpenAI.' :
          'A OpenAI não concluiu a resposta.';
      throw new ChatError(502, detail + ' Sua pergunta foi preservada para tentar novamente.');
    }
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
    if (agenda && agent === 'ana') {
      const filters = directRemoval(message, today);
      if (filters) return agenda.bulkRemoval(filters);
      const short = message.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/[.!]+$/, '');
      const recurringOnly = /^(?:sim[ ,]+)?(?:apague |exclua )?(?:a |as )?series? inteiras?$/.test(short);
      if (tokenPattern.test(body.pendingRemoval || '') && (recurringOnly || /^(?:sim(?:[ ,]+confirmo)?|confirmo|isso|pode apagar|pode prosseguir)$/.test(short))) {
        return agenda.continueRemoval(body.pendingRemoval, recurringOnly);
      }
    }
    const instructions = [
      `Você é ${agent === 'ana' ? 'Ana, secretária' : 'Fin, assistente financeiro'} na Agenda DEV.`,
      `Hoje é ${today} e amanhã é ${tomorrow} em America/Sao_Paulo.`,
      'Responda em português do Brasil.',
      'Chame a ferramenta para perguntas que exigem dados da Agenda. Nunca invente horários ou valores.',
      agent === 'ana' ?
        'Use agendar_atendimento somente para pedidos explícitos de agendamento com nome, data e hora. Use o contexto do mesmo pedido. Pergunte só o que falta. Nunca diga que gravou: o aplicativo mostrará o resultado.' :
        [
          'Você faz consultas financeiras de atendimentos e recusa pedidos de escrita. Responda direto usando a ferramenta para consultas, inclusive frases informais, fragmentos e erros de digitação ou transcrição como “segunda-ferias”.',
          '“Vou receber”, “vai dar” e “valor total dos atendimentos” usam total, incluindo pagos. “Quanto entra”, “falta receber”, “a receber” e “pendente” usam open. “Já recebi”, “recebi”, “recebimentos” e “caiu” usam received pela data do pagamento. “Quanto deu novembro?” e consultas genéricas sem indicação de critério usam both.',
          'Filtre o dia da semana indicado. Em uma continuação, mantenha os filtros da última consulta financeira bem-sucedida que não foram substituídos, inclusive mês, ano, dia e critério. Use as respostas do Fin no histórico para identificar esses filtros. “Mês todo” limpa o dia da semana.',
          'Sem contexto nem mês explícito, use o mês atual. Mês sem ano usa o ano atual ou o ano indicado pelo contexto. “Novembro passado” usa o novembro anterior ao mês atual. Nunca solicite o formato AAAA-MM. Quando houver dois períodos incompatíveis ou um recorte que a ferramenta não representa, faça uma única pergunta curta para resolver. Não consulte um mês inteiro quando houver um recorte explícito.',
        ].join(' '),
      agent === 'ana' && (agenda ?
        'Para séries informe a frequência e a quantidade ou a data final somente se indicada. Use alterar_atendimento para editar, remarcar, cancelar ou apagar. Identifique o cliente e a sessão original. Quando houver dúvida sobre o alcance de uma série, pergunte. Só prepare a exclusão se o usuário pedir explicitamente para apagar; cancelar preserva o histórico. A confirmação de apagar ocorre exclusivamente no botão do aplicativo.' :
        'Esta Agenda aceita apenas agendamentos avulsos. Não agende só a primeira sessão de uma série nem altere sessões existentes.'),
      agent === 'ana' && agenda && 'Para excluir por período, dia da semana, vários clientes, horários, recorrência ou pagamento, use revisar_exclusao_em_lote assim que os filtros estiverem claros. A lista e o botão serão gerados pelo servidor. Não peça confirmação por mensagem. Preserve limites já informados. “Até o fim do ano” começa hoje e termina em 31 de dezembro, salvo indicação diferente. “Não pagos” significa sem pagamento registrado, exceto quando o usuário citar o status Não pago. Se faltar dado que mude a seleção, faça só uma pergunta curta. Não use ferramentas de exclusão para hipóteses.',
    ].filter(Boolean).join(' ');
    const input = [...history.map(({ role, content }) => ({ role, content })), { role: 'user', content: message }];
    const output = await respond(input, instructions, {
      tools: [{
        type: 'function', name: tool.name, description: tool.description, strict: true,
        parameters: {
          type: 'object',
          properties: { [tool.field]: { type: 'string', description: tool.format }, ...(agent === 'fin' && finFields) },
          required: [tool.field, ...(agent === 'fin' ? Object.keys(finFields) : [])], additionalProperties: false,
        },
      }, ...(agent === 'ana' ? (agenda ? [recurringBookingTool, changeTool, bulkTool] : [bookingTool]) : [])],
      parallel_tool_calls: false,
      include: ['reasoning.encrypted_content'],
    });
    const calls = output.filter(item => item.type === 'function_call');
    if (!calls.length) {
      return { reply: cleanAnswer(output) };
    }
    const [call] = calls;
    if (calls.length !== 1 || !call.call_id || (call.status && call.status !== 'completed')) {
      throw new ChatError(502, 'A ação do agente não foi concluída. Sua pergunta foi preservada.');
    }
    let args;
    try { args = JSON.parse(call.arguments); }
    catch { throw new ChatError(502, 'Dados da ação inválidos.'); }
    if (agenda && agent === 'ana' && call.name === bulkTool.name) {
      if (!args || !validRemovalFilters(args)) return { reply: 'Quais atendimentos você quer apagar? Informe o cliente, o período ou outro filtro.' };
      const filters = Object.fromEntries(Object.keys(bulkFields).map(key => [key, args[key]]));
      return agenda.bulkRemoval(filters);
    }
    if (agent === 'ana' && call.name === bookingTool.name) {
      const { nome, data, horario, modalidade, frequencia = 'none', quantidade, ate } = args || {};
      if (!validText(nome, 100) || typeof data !== 'string' || !validDate(data) ||
          !validStart(horario) || ![null, 'Presencial', 'Online'].includes(modalidade) ||
          !['none', 'weekly', 'biweekly', 'monthly'].includes(frequencia) || (!agenda && frequencia !== 'none') ||
          (frequencia === 'none' && (quantidade != null || ate != null)) ||
          (quantidade != null && (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 104)) ||
          !optionalDate(ate) || (ate != null && (ate < data || quantidade != null))) {
        throw new ChatError(502, 'O agente não identificou dados válidos para o agendamento.');
      }
      const booking = { name: nome.trim(), date: data, start: horario, modality: modalidade || 'Presencial' };
      return agenda ? agenda.book({ ...booking, frequency: frequencia, count: quantidade, until: ate }) : { booking };
    }
    if (agenda && agent === 'ana' && call.name === changeTool.name) {
      const { acao, nome, data, horario, alcance, nova_data, novo_horario, modalidade, valor, duracao } = args || {};
      if (!['edit', 'cancel', 'delete'].includes(acao) || !validText(nome, 100) ||
          ![null, 'single', 'future', 'series'].includes(alcance) || !optionalDate(data) || !optionalDate(nova_data) ||
          (horario != null && !validStart(horario)) || (novo_horario != null && !validStart(novo_horario)) ||
          ![null, 'Presencial', 'Online'].includes(modalidade) ||
          (valor != null && (!Number.isFinite(valor) || valor < 0 || valor > 100000 || !/^\d+(\.\d{1,2})?$/.test(String(valor)))) ||
          (duracao != null && (!Number.isInteger(duracao) || duracao < 15 || duracao > 240))) {
        throw new ChatError(502, 'Não consegui identificar os dados da alteração. Confira o pedido e tente novamente.');
      }
      return agenda.change({ action: acao, name: nome.trim(), date: data, start: horario, scope: alcance,
        newDate: nova_data, newStart: novo_horario, modality: modalidade, value: valor, duration: duracao });
    }
    if (call.name !== tool.name) throw new ChatError(502, 'Consulta do agente inválida.');
    const period = args?.[tool.field];
    if (typeof period !== 'string' || !(agent === 'ana' ? validDate(period) : month.test(period))) {
      throw new ChatError(502, 'Período da consulta inválido.');
    }
    let filters;
    if (agent === 'fin') {
      const { criterio: mode, dia_da_semana: weekday } = args;
      if (!finModes.includes(mode) || (weekday !== null && ![0, 1, 2, 3, 4, 5, 6].includes(weekday))) {
        throw new ChatError(502, 'Não consegui identificar o critério da consulta.');
      }
      filters = { mode, weekday };
    }
    const task = { agent, period, filters, input, output, instructions, callId: call.call_id };
    if (agenda) {
      const result = await agenda.consult(agent, period, filters);
      if (filters) return finReply(period, filters, result);
      return { ...await explain(task, result), consultation: { period, result } };
    }
    if (pending.size >= 32) throw new ChatError(429, 'Há consultas demais em andamento. Tente novamente em instantes.');
    const id = randomUUID();
    const timer = setTimeout(() => pending.delete(id), 60000);
    timer.unref();
    pending.set(id, { ...task, timer });
    return { id, period, ...(filters && { filters }) };
  }

  async function finish({ id, result }) {
    const task = pending.get(id);
    if (!task) throw new ChatError(409, 'A consulta expirou. Envie a pergunta novamente.');
    const consume = () => {
      pending.delete(id);
      clearTimeout(task.timer);
    };
    if (task.filters) {
      const reply = finReply(task.period, task.filters, result);
      consume();
      return reply;
    }
    return explain(task, result, consume);
  }

  async function explain({ agent, period, input, output, instructions, callId }, result, consume) {
    let facts;
    if (agent === 'ana' && Array.isArray(result?.starts) && result.starts.length <= 24 &&
        result.starts.every(value => typeof value === 'string' && time.test(value))) {
      facts = { data: period, horarios: [...new Set(result.starts)].sort() };

    } else {
      throw new ChatError(400, 'Resultado da consulta inválido.');
    }
    consume?.();
    const final = await respond([
      ...input, ...output,
      { type: 'function_call_output', call_id: callId, output: JSON.stringify(facts) },
    ], instructions + ' Explique o resultado fornecido em texto curto. Use somente os fatos da ferramenta.');
    return { reply: cleanAnswer(final) };
  }

  async function run(operation) {
    if (!apiKey || !model) throw new ChatError(503, 'Configure OPENAI_API_KEY e OPENAI_MODEL no servidor e reinicie a prévia.');
    if (active >= 4) throw new ChatError(429, 'Há consultas demais em andamento. Tente novamente em instantes.');
    active++;
    try {
      return await operation();
    } finally {
      active--;
    }
  }

  const handle = async (req, res) => {
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
    try {
      const body = await readBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ChatError(400, 'Mensagem inválida.');
      const result = await run(() => {
        if (agenda && Object.hasOwn(body, 'confirmation')) {
          if (!tokenPattern.test(body.confirmation || '')) throw new ChatError(400, 'Confirmação inválida.');
          return agenda.confirmRemoval(body.confirmation);
        }
        if (agenda && Object.hasOwn(body, 'id')) throw new ChatError(400, 'O servidor consulta a agenda compartilhada diretamente.');
        return Object.hasOwn(body, 'id') ? finish(body) : start(body);
      });
      send(200, result);
    } catch (error) {
      if (error instanceof ChatError) send(error.status, { error: error.message });
      else send(502, { error: 'Não foi possível concluir a ação. Confira a Agenda antes de tentar novamente.' });
    }
  };
  return Object.assign(handle, { processTurn: body => run(() => start(body)) });
}
