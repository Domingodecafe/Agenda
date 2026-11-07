# Fin — preparação inicial (histórico)

> O upgrade offline já inclui conversa local, contas futuras, simulações e
> backup restaurável. Uso atual e verificação em
> [IMPLEMENTACAO-FIN-V2.md](IMPLEMENTACAO-FIN-V2.md). As descrições abaixo
> registram os limites da entrega inicial, anteriores ao upgrade.

Preparação local em 29/10/2026. O Fin usa **a mesma cópia da Agenda da Ana**,
na pasta `Sec.Ana`, em `/ana-dev/`. O aplicativo original não foi alterado.
Não publicar esta pasta por cima da Agenda original.

## Abrir e experimentar

Execute `node preview.mjs` nesta pasta. Abra
http://127.0.0.1:43188/ana-dev/ e escolha **Financeiro Fin**, ou abra
http://127.0.0.1:43188/ana-dev/fin-console.html.

1. Na cópia da Agenda, crie um cliente e sessões fictícios. Registre um
   pagamento com data e forma, usando o fluxo já existente da Agenda.
2. No Fin, escolha o mês e clique em **Atualizar dados**. A leitura também
   se renova a cada minuto com o painel visível e ao voltar à aba.
3. Cadastre despesas pagas fictícias. Confira recebidos, saídas, saldo,
   sessões encerradas sem pagamento e próximas sessões sem pagamento.
4. Experimente **Estornar**: mantém o registro, mas retira a despesa dos totais.
5. Use **Exportar para o Fin** para baixar o contrato JSON, relatório e despesas.
   A exportação refaz a leitura. Falha de leitura impede exportar dados antigos.

O painel ainda não conversa com um modelo de IA. O texto da análise é um
resumo calculado por regras. O prompt mestre prepara o comportamento do
futuro agente. Não há acesso bancário, WhatsApp, envio de cobranças ou pagamentos.

## Arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `fin-core.js` | Projeção de dados da Agenda, validações e cálculos em centavos |
| `fin-store.js` | Leitura da Agenda e persistência transacional de despesas |
| `fin-console.html`, `.css`, `.js` | Painel local, despesas e exportação |
| `PROMPT-MESTRE-FIN.md` | Identidade, limites e rotina do futuro agente |
| `CONTRATO-FIN.md` | Campos, regras e integração futura |
| `tests/fin.test.mjs` | Testes das regras e isolamento da integração |

## De onde vêm os dados

O Fin lê `ana-dev-main` no banco `ana-dev-agenda-db-v1`, store
`ana-dev-agenda`, com transação **readonly**. Essa é a Agenda DEV, não o
estado separado do simulador de conversa da Ana (`ana-dev-assistant-v1`).
Não existe importação automática do simulador: a limitação já existente
da Ana está descrita em `IMPLEMENTACAO-ANA-LOCAL.md`.

Se a Agenda marcou o fallback local como ativo, o Fin lê a mesma chave
`ana-dev-agenda-state-v1`. Não recorre a outro banco em caso de erro.
O Fin não grava pagamentos, clientes ou sessões. As despesas ficam no banco
próprio `fin-dev-finance-v1`, store `ledger`, chave `expenses`.
Cada inclusão tem ID idempotente e só termina após o commit IndexedDB.

O painel é administrativo local, sem autenticação de servidor; não expor
publicamente. Não lê credenciais da nuvem. A CSP local continua bloqueando
conexões externas. A exportação não inclui nomes, contatos, notas de clientes,
modalidades ou anexos. Descrições de despesas e referências ainda podem
identificar pessoas: cuide do arquivo e evite dados pessoais nas descrições.

As despesas são locais ao navegador. **A exportação é uma cópia para análise,
não um mecanismo de restauração**; ainda falta implementar importação e backup
restaurável do livro de despesas antes de usar dados reais.

## Critérios financeiros

- Recebidos do mês: status Pago e data válida do pagamento naquele mês,
  incluindo antecipações. Não usar o mês da sessão como mês do recebimento.
- Pagos sem data válida: separados, nunca recebem uma data inventada.
- Para receber: todas as sessões encerradas sem status Pago, inclusive
  Não pago; o mês escolhido não limita essa lista.
- Próximas: sessões ainda não encerradas, sem pagamento, no mês da sessão.
- Bloqueios e tipo Outro ficam fora. Cancelados sem pagamento ficam para
  revisão, fora das previsões; pagamentos já registrados continuam no caixa.
- Despesas: apenas saídas efetivamente pagas, cadastradas manualmente no Fin.
- Saldo: recebidos menos despesas pagas cadastradas no mês. Não é lucro
  contábil, saldo bancário, DRE nem uma estimativa de impostos.
- Moeda BRL; inteiros em centavos; calendário America/Sao_Paulo.
- Valores, datas e status inválidos geram alertas e exclusão dos cálculos;
  IDs de sessão ausentes ou duplicados interrompem a leitura inteira.
- A Agenda não representa parcelas ou pagamentos parciais por sessão; o Fin
  não inventa essa divisão. Estornos de recebimentos devem ser feitos na Agenda.

## Próximas etapas de estudo

1. Validar categorias de despesas, contas, metas, relatórios e quem acessa cada função.
2. Implementar backup restaurável, lançamentos de outras receitas, parcelas,
   estornos parciais e conciliação de comprovantes sem baixa automática.
3. Criar serviço autenticado com autorização, auditoria e ferramentas limitadas.
4. Conectar um modelo ao contrato do Fin; manter cálculos fora do modelo.
5. Testar com dados fictícios antes de decidir como integrar a produção.

Nenhum SQL, serviço remoto ou publicação é necessário nesta etapa.

## Verificar

```powershell
node --test tests/fin.test.mjs tests/policy.test.mjs tests/isolation.test.mjs tests/sync.test.mjs tests/availability.test.mjs
```

Resultado desta entrega: **79 testes aprovados**. Teste adicional no navegador
com perfil descartável e IndexedDB real aprovou leitura da fonte, despesas,
persistência após recarga, concorrência com ID idempotente, estorno, exportação,
fallback, bloqueio após perda da fonte e preservação integral do estado fictício
da Agenda e de uma sentinela do banco original. Nenhuma requisição externa ou
erro JavaScript foi observado nesse fluxo.

O script `tests/fin.browser.mjs` exige a prévia em execução e Playwright
disponível no `NODE_PATH`; usa Edge headless por padrão, alterável por
`FIN_BROWSER_CHANNEL`. Evidências: `test-results/fin-local.png` e
`test-results/fin-mobile.png`. As capturas contêm somente fixtures; o contexto
de teste foi descartado. O painel teve verificação visual em desktop e celular.

Cache DEV atualizado para v7 para disponibilizar o novo acesso e os arquivos
do Fin. Uma janela antiga da Agenda DEV pode precisar aplicar **Atualizar**.
Nenhum arquivo da Agenda original, SQL remoto, publicação, commit ou push foi
alterado ou executado nesta entrega.
