# Fin v2 — planejamento financeiro e conversa offline

Upgrade de 29/10/2026. Implementado na mesma cópia da Agenda usada pela Ana,
em `Sec.Ana`, sob `/ana-dev/`. **A Agenda original não foi alterada.**
Esta entrega usa exclusivamente dados fictícios e não conecta modelos ou serviços.

## Abrir

Execute `node preview.mjs` e acesse
http://127.0.0.1:43188/ana-dev/fin-console.html.
Na Agenda DEV, o acesso também está no cabeçalho e no Resumo. Uma janela antiga
pode precisar aplicar **Atualizar**; o cache DEV passou a v8.

## Conversa local

O painel tem um **simulador local**, com interpretação por regras documentadas.
Não é um modelo de IA conectado. Experimente:

- “Quanto recebi neste mês?” ou “Quanto gastei?”
- “Quanto tenho para receber?”
- “Compare este mês com o anterior.” ou “Compare 2026-10 com 2026-09.”
- “Quanto deve sobrar até o fim do mês?”
- “E no mês anterior?” — conserva a intenção anterior e muda o mês selecionado.
- “E se eu tiver duas sessões a menos?”
- “Prepare uma despesa de R$ 150 de aluguel.”
- “Prepare uma conta de R$ 100 de internet em 2026-11-10.”
- “Prepare uma conta de R$ 100 de internet mensal.”

O mês do seletor é o contexto da conversa. “Mês atual” volta ao mês do relógio;
“mês anterior/passado” e “próximo mês” são relativos ao contexto. Datas explícitas
usam YYYY-MM ou YYYY-MM-DD. O interpretador não compreende toda linguagem
natural: pedidos desconhecidos mostram exemplos. Quantidades nas simulações
podem ser números ou palavras de uma a dez sessões.

Cada consulta mostra período, instante de leitura, referências e alertas. A
comparação usa o realizado e não inventa causas para variações. A simulação
retira hipoteticamente as sessões de maior e menor valor, mostrando uma faixa
de resultados; não decide quais serão canceladas e não grava nada.

Rascunhos ficam apenas no formulário até clicar **Confirmar rascunho**. Revise
todos os campos. Despesa sem data explícita sugere hoje; conta sem data deixa
o vencimento vazio e exige preenchimento. A categoria sugerida é Outros, ou
a primeira categoria disponível. Campos podem ser corrigidos antes de confirmar.
Falha de persistência mantém o rascunho e não confirma o lançamento.
Conversas não persistem após recarga; o mês selecionado persiste.

## Contas e projeções

No formulário, selecione despesa já paga, conta única ou conta mensal. O primeiro
vencimento define o dia original da recorrência. Dias 29–31 ajustam para o
último dia dos meses mais curtos e voltam ao dia original nos demais meses.
Cada ocorrência tem um ID próprio. A série segue sem fim automático; neste
protótipo, interromper cobranças exige cancelar as ocorrências afetadas em
cada mês. Ainda não há edição ou encerramento de uma série inteira.

**Pagar** abre uma confirmação com data. A despesa fica vinculada à ocorrência:
sai da previsão e entra no realizado sem duplicação. Pagar em outro mês
respeita a data real. Estornar a despesa reabre a conta. Cancelar uma ocorrência
mensal preserva as demais e mantém histórico. Não há pagamentos parciais.

Os indicadores são:

1. Resultado registrado = recebidos − despesas pagas no mês.
2. Entradas previstas = sessões futuras ainda não pagas no mês, com pagamento
   esperado na data de cada sessão.
3. Saídas previstas = contas abertas com vencimento no mês, inclusive vencidas.
4. Resultado estimado = resultado registrado + entradas previstas − saídas previstas.

Pendências de sessões passadas ficam separadas. Antecipações já pagas não entram
de novo. Cancelamentos não geram receita prevista. Pagos sem data válida ficam
fora dos recebidos mensais. Meses encerrados mostram realizado e pendências,
sem resultado estimado. Uma conta antiga aberta não é transferida automaticamente
ao mês atual; consulte seu mês de vencimento.

O resultado depende das sessões e contas cadastradas: não pressupõe novas
sessões ou despesas desconhecidas, não inclui saldo anterior e não representa
saldo bancário ou lucro. A categoria Tributos e taxas não calcula tributos.

## Categorias e backup

Em **Categorias e cópias de segurança**, edite uma categoria por linha.
Categorias usadas precisam permanecer; novas categorias podem ser adicionadas.
Categorias inicialmente disponíveis: espaço de atendimento, ferramentas e
assinaturas, materiais, divulgação, formação, tributos e taxas, outros.

**Baixar backup** gera `fin.backup.v2`, incluindo despesas, estornos, contas,
cancelamentos e configurações. **Escolher backup para revisar** valida o arquivo
antes de mostrar contagens e os dados que serão substituídos. Confirmar
substitui somente o livro do Fin; cancelar não grava. Se outra instância mudar
o livro depois da prévia, a restauração é bloqueada até selecionar o arquivo
novamente. Limites: 10 MB no upload, 50.000 registros e 50 categorias.

São recusados IDs repetidos, valores/datas inválidos, categorias ausentes e
pagamentos sem conta correspondente ou duplicados. **Exportar para o Fin**
continua sendo um arquivo de análise `fin.agenda.v1`, sem função de restauração.

Uma cópia anterior é salva atomicamente em `before-last-restore` e pode ser
baixada pelo botão correspondente. Ela conserva apenas a última substituição;
mantenha também backups externos. Uma restauração limpa rascunhos e conversa
da aba e aplica as configurações restauradas. Arquivos são financeiros privados.

## Arquitetura e compatibilidade

- `fin-core.js`: projeção da Agenda, valores em centavos, relatórios, previsão
  e simulação, com relógio injetável e fuso America/Sao_Paulo.
- `fin-ledger.js`: validações, ocorrências, transições idempotentes e backup.
- `fin-assistant.js`: `FinInterpreter.parse` interpreta; `FinTools.execute`
  consulta, compara, simula ou prepara rascunho. Nenhum desses dois grava dados.
- `fin-store.js`: leitura da Agenda e persistência transacional do livro.
- `fin-console.*`: revisão e confirmação humana, conversa e arquivos.

Mantém o banco `fin-dev-finance-v1`, store `ledger`, chave `expenses`.
Despesas v1 recebem categoria Outros sem perder IDs, valores, datas ou estornos.
A chave nova `planning` guarda versão 2, revisão, contas e configurações. As
duas chaves são lidas/gravadas na mesma transação. Leituras não fazem migração
destrutiva; a normalização é persistida na próxima alteração confirmada.

O Fin continua lendo somente a chave da Agenda DEV, ou seu fallback ativo.
Não lê o simulador separado da conversa da Ana, não modifica recebimentos,
clientes ou sessões, não dá baixa por comprovante, não envia cobranças,
não negocia condições, não bloqueia agenda e não emite documentos.

O painel é administrativo local sem autenticação de servidor. Não publicar
publicamente. Não há shell, execução de código gerado, busca externa, análise
de documentos, conexão bancária ou SDK novo. Uma conexão futura pode trocar
o interpretador sem reescrever cálculos ou permissões. Provedor/modelo ficam
para outra etapa, sem configuração fictícia ou chave no navegador.

## Verificação

```powershell
node --test tests/fin.test.mjs tests/fin-upgrade.test.mjs tests/policy.test.mjs tests/isolation.test.mjs tests/sync.test.mjs tests/availability.test.mjs
```

A suíte inicial de 79 testes foi mantida e recebeu mais 19 testes para o upgrade:
**98 testes aprovados**, além dos dois fluxos de navegador aprovados. A sintaxe
dos módulos e `git diff --check` também foram verificados sem erros.
Com a prévia em execução e Playwright disponível no `NODE_PATH`:

```powershell
node tests/fin.browser.mjs
node tests/fin-upgrade.browser.mjs
```

O segundo script usa relógio fixo e contexto descartável. Verifica migração v1,
conversa, rascunho sem gravação, projeções, recorrência, pagamento e estorno,
categorias, backup/restauração com prévia e cancelamento, conflito entre
instâncias e rollback real de IndexedDB após iniciar a gravação. Verifica
também persistência, acesso offline com service worker, layout móvel, ausência
de requisições externas e preservação integral da Agenda fictícia e de uma
sentinela do banco original. Não usa o perfil pessoal do navegador.

Evidências visuais em `test-results/fin-upgrade-desktop.png`,
`test-results/fin-upgrade-mobile.png` e `test-results/fin-upgrade-form-mobile.png`.

Nenhum SQL remoto, publicação, commit ou push foi executado.
