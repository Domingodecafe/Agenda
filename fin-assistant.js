/* Interpretação offline separada das ferramentas. Nenhuma chamada externa ou gravação. */
(() => {
  'use strict';
  const money = n => (n / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const normalize = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function shiftMonth(m, shift) {
    FinLedger.month(m);
    const [y, n] = m.split('-').map(Number);
    const date = new Date(Date.UTC(y, n - 1 + shift, 15));
    return date.toISOString().slice(0, 7);
  }
  function parse(message, context, now = new Date()) {
    if (typeof message !== 'string' || message.length > 1000) throw new Error('Use uma mensagem de até 1.000 caracteres.');
    const q = normalize(message).trim(), base = FinLedger.month(context.month);
    const explicit = q.match(/\b\d{4}-(?:0[1-9]|1[0-2])\b/g) || [];
    let month = explicit[0] || (/mes atual/.test(q) ? FinCore.dateParts(now).date.slice(0, 7) : /mes (?:anterior|passado)/.test(q) && !/compar/.test(q) ? shiftMonth(base, -1) : /proximo mes/.test(q) ? shiftMonth(base, 1) : base);
    if (/\b(prepare|preparar|registre|registrar|lance|lancar|cadastre|cadastrar)\b/.test(q)) {
      if (!/\b(despesa|conta)\b/.test(q)) return { intent: 'help', month };
      const match = q.match(/(?:r\$\s*|\bde\s+)(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[,.]\d{1,2})?)(?=\s|$|[!?])/);
      const amount = match?.[1];
      const value = amount ? (amount.includes(',') ? amount.replace(/\./g, '').replace(',', '.') : amount) : '';
      const dateMatch = message.match(/\b\d{4}-\d{2}-\d{2}\b/);
      const descriptionMatch = message.match(/(?:R\$\s*|\bde\s+)\d[\d.,]*\s+(?:de\s+)?(.+)/i);
      const description = (descriptionMatch?.[1] || '').replace(/\s+(?:em|para|no dia|com vencimento em)\s+\d{4}-\d{2}-\d{2}.*/i, '').replace(/\s+(?:todo m[eê]s|mensal(?:mente)?)[.!?]?$/i, '').replace(/[.!?]$/, '').trim();
      return { intent: 'draft', month, draft: { description, value, date: dateMatch?.[0] || (/\bconta\b/.test(q) ? '' : FinCore.dateParts(now).date), category: 'Outros', kind: /\bconta\b/.test(q) ? (/mensal|todo mes/.test(q) ? 'monthly' : 'once') : 'paid' } };
    }
    if (/compar|diferenca|por que.*(?:menos|mais)/.test(q)) return { intent: 'compare', month, otherMonth: explicit[1] || shiftMonth(month, -1) };
    if (/a menos|menos sessoes/.test(q)) {
      const words = { uma: 1, um: 1, duas: 2, dois: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };
      const token = q.match(/\b(\d+|uma|um|duas|dois|tres|quatro|cinco|seis|sete|oito|nove|dez)\s+sess(?:oes|ao)/)?.[1];
      return { intent: 'simulate', month, count: token ? (words[token] || Number(token)) : null };
    }
    if (/sobrar|sobra|previs|proje|fim do mes/.test(q)) return { intent: 'forecast', month };
    if (/a receber|para receber|penden|devem|falta receber/.test(q)) return { intent: 'due', month };
    if (/recebi|recebido|resultado|gastei|despesa|entrou/.test(q)) return { intent: 'result', month };
    if (/^(e\s+)?(?:no\s+)?(?:mes\s+)?(?:anterior|passado)|^e no mes|^e em \d{4}-\d{2}/.test(q)) return { intent: ['result', 'due', 'forecast', 'compare'].includes(context.lastIntent) ? context.lastIntent : 'result', month, otherMonth: shiftMonth(month, -1) };
    return { intent: 'help', month };
  }
  function execute(request, snapshot, ledger, now = new Date()) {
    const { intent, month } = request;
    const r = FinCore.forecast(snapshot, ledger, month, now);
    let text, data = r, rows = [...r.received, ...r.expenses];
    const actual = x => `Recebidos: ${money(x.receivedCents)}; despesas pagas: ${money(x.expenseCents)}; resultado registrado: ${money(x.netCashCents)}.`;
    const limitations = 'Estimativa das sessões e contas cadastradas; não é saldo bancário nem lucro. Pendências de sessões encerradas não são recebimentos previstos. Não há cobrança automática.';
    if (intent === 'result') text = actual(r);
    else if (intent === 'due') { text = `Há ${r.due.length} sessão(ões) encerrada(s) sem pagamento, de todos os meses: ${money(r.dueCents)}. Pagos sem data válida: ${money(r.undatedCents)}, fora dos recebidos mensais.`; rows = [...r.due, ...r.undated]; }
    else if (intent === 'forecast') {
      text = r.historical ? `${actual(r)} Mês encerrado: sem projeção de receitas futuras. Contas ainda abertas desse mês: ${money(r.plannedExpenseCents)}.` : `${actual(r)} Entradas previstas: ${money(r.upcomingCents)}; saídas previstas: ${money(r.plannedExpenseCents)}. Resultado estimado: ${money(r.projectedCents)}. Pagamento das sessões previsto para a data de cada sessão.`;
      rows.push(...r.upcoming, ...r.openObligations);
    } else if (intent === 'compare') {
      const other = FinCore.forecast(snapshot, ledger, request.otherMonth, now);
      const delta = r.netCashCents - other.netCashCents;
      if (!Number.isSafeInteger(delta)) throw new Error('Comparação fora do limite.');
      text = `${month}: ${actual(r)}\n${request.otherMonth}: ${actual(other)}\nDiferença do resultado registrado: ${money(delta)}. A comparação usa o realizado; não atribui causas que os registros não demonstram.`;
      data = { current: r, previous: other, differenceCents: delta }; rows.push(...other.received, ...other.expenses);
    } else if (intent === 'simulate') {
      if (!request.count) throw new Error('Quantas sessões a menos? Exemplo: “E se eu tiver duas sessões a menos?”.');
      data = FinCore.simulate(snapshot, ledger, month, request.count, now);
      text = `Simulação de ${request.count} sessão(ões) futura(s) sem pagamento a menos: o resultado estimado ficaria entre ${money(data.minCents)} e ${money(data.maxCents)}. A faixa considera retirar as sessões de maior e menor valor; não escolhi quais serão canceladas. Nenhum registro foi alterado.`;
      rows = [...data.cheapest, ...data.highest, ...r.received, ...r.expenses, ...r.openObligations];
    } else if (intent === 'draft') {
      text = 'Preparei um rascunho. Confira descrição, categoria, data e valor no formulário e clique em Confirmar rascunho. Nenhum lançamento foi gravado.'; rows = []; data = request.draft;
    } else {
      text = 'Sou o simulador local do Fin. Posso consultar recebidos, pendências, comparar meses, projetar o resultado e simular sessões a menos. Exemplos: “Quanto deve sobrar?”, “Compare este mês com o anterior”, “Prepare uma despesa de R$ 150 de aluguel”. Para outra data, use YYYY-MM ou YYYY-MM-DD. Não compreendi uma operação suportada nesta mensagem.'; rows = []; data = null;
    }
    return { intent, month, sourceAt: snapshot.generatedAt, calculatedAt: now.toISOString(), data, text, limitations,
      warnings: snapshot.warnings, references: [...new Set(rows.map(e => e.appointmentId || e.id))], draft: request.draft || null };
  }
  globalThis.FinInterpreter = Object.freeze({ parse, shiftMonth });
  globalThis.FinTools = Object.freeze({ execute });
})();
