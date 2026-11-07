# Contrato Agenda → Fin v1

O adaptador atual é local: `FinStore.agenda()` devolve uma projeção financeira
da cópia DEV. Não existe endpoint HTTP/API pública nesta entrega.
`FinStore.expenses()` lê as saídas do Fin. `FinCore.report(snapshot, expenses,
month, now)` calcula os indicadores. O relógio pode ser injetado nos testes.

## Snapshot

```json
{
  "schemaVersion": "fin.agenda.v1",
  "source": "ana-dev-agenda",
  "currency": "BRL",
  "timezone": "America/Sao_Paulo",
  "generatedAt": "2026-10-29T15:00:00.000Z",
  "records": [{
    "appointmentId": "sessao-ficticia-1",
    "clientRef": "cliente-ficticio-1",
    "sessionDate": "2026-10-28",
    "endTime": "11:00",
    "amountCents": 20000,
    "status": "Pago",
    "paymentDate": "2026-10-29",
    "paymentMethod": "PIX",
    "cancelled": false
  }],
  "warnings": []
}
```

`appointmentId` é a identidade estável da sessão; não somar novamente um
snapshot anterior ao atual. Cada leitura substitui a anterior, pois pagamentos,
valores e sessões podem ser corrigidos ou excluídos na fonte. O snapshot não é
um log de eventos nem histórico de auditoria. O histórico dos pagamentos
continua na Agenda. `clientRef` usa o ID do cliente ou `session:<id>` para
sessões sem vínculo: não unir pessoas pelo nome por suposição.

Datas de calendário são YYYY-MM-DD. `generatedAt` é um instante UTC; o corte
das sessões considera São Paulo. `paymentDate=null` em sessões sem pagamento
ou sem data válida. `paymentMethod` pode ser null. Nunca adivinhar data,
pagamento ou valor padrão ausente.

Alertas possíveis: `invalid_amount`, `invalid_session_date`,
`unknown_financial_status`, `paid_without_valid_date`, `cancelled_unpaid_review`.
Cada alerta inclui `appointmentId`. Alertas não são baixas ou alterações.

## Exportação

Além do snapshot, o JSON baixado inclui `selectedMonth`, `expenses` e `report`.
O relatório contém totais em centavos e listas que sustentam os totais.
`dueCents` abrange todos os meses; `receivedCents`, `expenseCents` e
`netCashCents` seguem o mês do caixa; `upcomingCents` segue o mês das sessões.
`undatedCents` reúne pagos sem data válida, fora do caixa mensal.

Despesas: `id`, `date`, `description`, `amountCents`, `createdAt`,
`actor=owner-local`, e `voidedAt` quando estornadas. Uma mesma operação com
o mesmo ID e os mesmos dados não duplica a despesa. Reutilizar ID com outros
dados falha. O estorno é permanente no protótipo e preserva o lançamento.

## Ferramentas remotas previstas para o agente

| Ferramenta futura | Comportamento |
| --- | --- |
| consultar_financeiro | Ler snapshot autorizado e gerar relatório verificável |
| listar_pendencias | Mostrar sessões e alertas sem enviar cobranças |
| propor_despesa | Preparar lançamento para revisão do proprietário |
| confirmar_despesa | Gravar com identidade autenticada e ID idempotente |
| propor_correcao | Encaminhar inconsistência para correção na Agenda |

Os nomes acima são planejamento, não APIs já publicadas. A interface local
implementa leitura, inclusão confirmada e estorno de despesas e contas; não há ferramenta
autônoma que movimente dinheiro ou marque sessões como pagas.

Para um futuro backend: derivar usuário e marca da sessão autenticada, validar
escopo no servidor, limitar campos de leitura, rejeitar versões desconhecidas,
usar centavos inteiros e operações idempotentes, registrar autor e motivo das
mudanças e manter segregação por marca. Não colocar chave privilegiada no cliente.

## Interfaces locais do upgrade v2

`FinStore.read()` devolve `{version:2, revision, expenses, obligations, settings}`.
O banco/store v1 permanece; novas propriedades são persistidas na chave `planning`.
Cada despesa acrescenta `category` e, se pagar conta, `occurrenceId`. Contas têm
`id`, `description`, `amountCents`, `category`, `startDate`, `recurrence` (once ou
monthly), `createdAt` e `cancelled` (data da ocorrência e instante da alteração).
Configurações guardam `categories` e `selectedMonth`.

`FinLedger.occurrences(ledger, month)` deriva IDs `<obligationId>@<vencimento>`
e situação open/paid/cancelled. `FinCore.forecast(snapshot, ledger, month, now)`
acrescenta `plannedExpenseCents`, `projectedCents` (null para mês encerrado),
`historical`, `occurrences` e `openObligations` ao relatório. `FinCore.simulate`
recebe também uma quantidade de sessões e devolve faixa `minCents`/`maxCents`,
com as sessões que fundamentam os extremos, sem gravar dados.

`FinInterpreter.parse(message, {month,lastIntent}, now)` devolve uma intenção:
result, due, forecast, compare, simulate, draft ou help. `FinTools.execute`
recebe intenção, snapshot, livro e relógio; devolve `text`, `data`, `month`,
`sourceAt`, `calculatedAt`, `references`, `warnings`, `limitations` e eventual
`draft`. Essa camada não importa o store nem executa operações de escrita.

O painel confirma usando `FinStore.addExpense`, `addObligation`, `payOccurrence`,
`voidExpense`, `cancelOccurrence` ou `saveSettings`. Inclusões e pagamentos
recebem ID idempotente; as regras são revalidadas na transação de gravação.

Backup: `FinLedger.backup` gera `{schemaVersion:'fin.backup.v2',currency:'BRL',
timezone:'America/Sao_Paulo',createdAt,state}`. `validateBackup` verifica e
normaliza sem gravar. `FinStore.restore(backup, expectedRevision)` substitui
somente o livro do Fin, se a revisão ainda for a da prévia, e preserva atomicamente
a cópia anterior. `FinStore.previousBackup()` recupera essa cópia. O snapshot
da Agenda e o arquivo de análise continuam na versão `fin.agenda.v1`.
