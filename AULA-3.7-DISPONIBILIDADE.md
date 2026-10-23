# Ana DEV — Aula 3.7 — 23/10/2026

## Entrega e preservação

Operação de leitura **consultar_disponibilidade** implementada no projeto
Supabase de desenvolvimento `dpdxzbbzymkygutwefww`, sem integração com WhatsApp,
n8n ou modelo de linguagem. Nenhuma operação desta API cria, altera ou cancela
agendamentos. A Agenda original e sua publicação continuam preservadas.

O commit anterior correto era **2b38d04** (não 2638d04). Antes desta etapa ele
estava apenas localmente. A auditoria dos 25 arquivos versionados não encontrou
senhas, tokens privados, chaves privadas, backups ou cadastros de pacientes.
O JSON versionado da Aula 3.6 contém resultados agregados e metadados de teste;
as cópias de recuperação locais permanecem ignoradas pelo Git e não são enviadas.
O commit foi enviado exclusivamente a `feat/ana-supabase`.

A configuração de publicação foi lida, sem alterações: GitHub Pages utiliza
`main`, caminho `/`, modo legacy. O SHA da `main` observado antes e depois do
envio foi `d4051cc283bda20674e9e579bdfadc24f8feaf3c`. Não houve merge ou
publicação da PWA. **Apenas a nova Edge Function foi ativada no Supabase DEV**;
isso não é um deploy da Agenda original.

## Endpoint e contrato

`POST https://dpdxzbbzymkygutwefww.supabase.co/functions/v1/consultar_disponibilidade`

Headers: `Content-Type: application/json`, `apikey: <CHAVE_PUBLICA>` e
`Authorization: Bearer <JWT_DE_USUARIO_AUTH_AUTORIZADO>`.
Uma chave pública sozinha não autentica o usuário. Não coloque JWTs, senhas ou
chaves secretas em código, URLs, documentos de agente ou no modelo de IA.

Data única:

```json
{"data":"2026-10-23"}
```

Período inclusivo (máximo 31 dias):

```json
{"data_inicio":"2026-10-23","data_fim":"2026-10-30"}
```

Somente essas propriedades são aceitas. `owner_id`, `user_id`, identificadores
de agenda e query strings são recusados. Datas devem existir, estar entre
1900-01-01 e 2100-12-31, e o fim não pode anteceder o início. O corpo é limitado
a 2 KiB. A função só aceita POST, não oferece CORS público e não é integrada
ao navegador da Agenda nesta etapa. As duas chamadas externas têm timeout.

Resposta: ambiente, fuso `America/Sao_Paulo`, duração de 60 minutos, período,
revisão da fonte e uma lista de dias com intervalos locais e seus equivalentes
UTC. A lista positiva da Edge Function impede que campos adicionais do banco
sejam repassados acidentalmente.

Os inícios são calculados em **grade de 60 minutos ancorada no expediente**.
Por exemplo, uma ocupação 09h30–10h15 exclui os slots 09h–10h e 10h–11h; não
cria um slot deslizante às 10h15. Usam-se intervalos semiabertos: uma sessão
encerrada às 15h não ocupa o slot iniciado às 15h.

Expediente aplicado: segunda/sexta 14h–19h; terça/quarta/quinta 8h–12h e
14h–19h; sábado 8h–12h; domingo fechado. Nenhum horário de almoço ou fora do
expediente é oferecido. Qualquer sobreposição de atendimento ou bloqueio
elimina o slot. Cancelamentos explicitamente marcados são ignorados; o aplicativo
atual normalmente remove a ocorrência cancelada.

## Arquitetura e autorização

1. A plataforma exige JWT (`verify_jwt=true`).
2. A Edge Function valida novamente a sessão no servidor Auth (`/auth/v1/user`),
   recusando inclusive usuários de Anonymous Auth.
3. Ela chama somente o RPC de disponibilidade, com o JWT daquele chamador.
   **Não faz SELECT de agenda_snapshots e não recebe o documento administrativo.**
4. O wrapper público é SECURITY INVOKER e só pode ser executado por
   `authenticated`; `anon` e PUBLIC não têm permissão.
5. O cálculo fica em uma função STABLE dentro de `ana_private`, com
   SECURITY DEFINER intencional e `search_path=''`. Ela verifica `auth.uid()`
   e resolve a agenda pelo próprio usuário ou por uma concessão administrativa
   explícita. Não recebe um proprietário fornecido pelo cliente.
6. Esse privilégio é usado exclusivamente para ler a agenda autorizada e
   projetar intervalos. Nomes, telefones, notas, valores, IDs de pacientes e
   detalhes de compromissos nunca fazem parte do retorno.

A tabela privada `availability_grants` mapeia um ator Auth a uma única agenda.
Tem RLS, política restritiva de negação, permissões de tabela revogadas e não é
exposta no Data API. Padrões de EXECUTE público para futuras funções privadas
também foram revogados. **Nenhum ator do n8n foi criado ou conectado.**

Para uma integração futura, o administrador deverá provisionar uma conta Auth
dedicada e conceder somente a consulta à agenda em `ana_private.availability_grants`.
O n8n guardará a credencial e o refresh token no armazenamento seguro do servidor.
Esse ator não se torna proprietário do snapshot do psicólogo: as políticas RLS
existentes continuam impedindo que leia ou altere aquele documento diretamente.
O agente recebe somente a ferramenta de consulta e seu resultado; nunca a
credencial administrativa ou uma ferramenta de SELECT em tabelas.

Nesta entrega não foi criada conta persistente adicional nem concessão de n8n.
A conta administrativa existente foi usada apenas para os testes HTTP fictícios.
Antes de fornecer acesso a terceiros, validar também o provisionamento, a
revogação e o ciclo de renovação da conta dedicada.

## Falha fechada e limites de leitura

Se não houver snapshot para a identidade autorizada, se um compromisso tiver
data/horários inválidos ou se o banco falhar, a operação retorna erro controlado,
sem gerar uma agenda livre por suposição. Mais de 20 mil itens de agenda também
gera indisponibilidade, limitando o processamento de snapshots grandes.

Erros não encaminham mensagens internas do banco nem objetos de autenticação.
Respostas usam `Cache-Control: no-store`. Exemplos: 401 sem autenticação,
400 para consulta inválida, 405 para método não permitido, 413 para corpo grande,
415 para conteúdo não JSON e 503 para fonte/autenticação indisponível.
A plataforma pode recusar um JWT inválido antes de o handler executar.

## Testes executados

`node --test tests/isolation.test.mjs tests/sync.test.mjs tests/availability.test.mjs`
terminou com **40 testes aprovados, zero falhas** (29 anteriores e 11 novos).

`tests/availability.database.sql` passou no banco DEV com fixtures inteiramente
fictícias dentro de uma transação revertida ao final. Verificou:

- Todas as faixas de expediente, domingo, dia livre e dia totalmente ocupado.
- Bloqueio, sobreposição parcial, adjacência e cancelamento.
- Duas ocorrências materializadas da mesma série recorrente.
- Conversão para São Paulo, inclusive uma data histórica com horário de verão.
- Período inclusivo e recusa de intervalo excessivo.
- Ausência de nomes, telefone, notas, valores, payload e IDs no resultado.
- RLS negando o snapshot de outro usuário, ausência de agenda e negação de
  acesso à tabela de concessões.
- Ausência de identidade e Anonymous Auth recusados.
- Registro corrompido gerando erro genérico, sem horários inventados.
- Chamadas de consulta sem avanço de revisão.

Nos testes SQL de RLS foram usadas claims controladas de outra identidade no
papel `authenticated`, dentro da transação. Não se tratou de login HTTP com
uma segunda conta Auth persistente.

`tests/availability.integration.mjs` passou **9 verificações HTTP reais** contra
a Edge Function ativa: ausência de autenticação, token forjado, data ocupada,
bloqueios, domingo, período/recorrência, tentativa autenticada de escolher outro
usuário pelo corpo e URL, método/parâmetros inválidos e imutabilidade do snapshot.
As credenciais foram recebidas em memória via stdin sem eco e a sessão de teste
foi encerrada com logout local. Não foram gravadas no repositório.

O relatório `test-results/aula37-disponibilidade.json` contém somente resultados
e a demonstração de intervalos livres. O driver local de testes compara o snapshot
fictício antes/depois para verificar imutabilidade; isso não faz parte da Edge
Function. O snapshot final continua na **revisão 16**.

O advisor não apontou um novo alerta de segurança ao concluir. Permanece o aviso
preexistente de [proteção contra senhas vazadas desativada](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection),
cuja configuração não foi alterada nesta etapa.

## Demonstração validada

Consulta de 23/10/2026, usando exclusivamente os compromissos fictícios:

| Intervalo local | Resultado |
| --- | --- |
| 14h–15h | Disponível |
| 15h–16h | Ocupado; não retornado pela API |
| 16h–17h | Disponível |
| 17h–18h | Disponível |
| 18h–19h | Disponível |

O resultado identifica São Paulo e a revisão 16. Por exemplo, 14h local aparece
como `2026-10-23T17:00:00.000Z`, sem expor quem ocupa o intervalo excluído.

## O modelo de snapshots é suficiente?

**Para esta leitura limitada, sim:** uma leitura consistente do documento no
banco permite calcular disponibilidade sem enviar o documento a outro serviço.
O retorno contém a revisão consultada. Compromissos recorrentes são considerados
pelas ocorrências já gravadas; não se inventam ocorrências além das materializadas
pelo aplicativo. Alterações locais ainda não sincronizadas não são visíveis à API.

**Para agendamento automático, deve-se evoluir o banco antes de liberar escrita:**
normalizar agenda/atendimentos/bloqueios e implementar reserva transacional,
proteção de sobreposição, idempotência, autorização por operação e auditoria.
Uma consulta de disponibilidade não reserva horário: outra operação pode ocupar
o slot depois da resposta. A API permanece exclusivamente informativa e de leitura.

## Arquivos desta aula

- `supabase/ana-availability.sql`: projeção privada, concessões e RPC seguro.
- `supabase/functions/consultar_disponibilidade/index.ts`: entrada Edge DEV.
- `supabase/functions/consultar_disponibilidade/handler.js`: autenticação,
  validação e resposta por lista positiva, sem dependências externas.
- `supabase/config.toml`: JWT obrigatório nessa função.
- `tests/availability.test.mjs`: testes locais do contrato/privacidade.
- `tests/availability.database.sql`: cálculo, privacidade e RLS com rollback.
- `tests/availability.integration.mjs`: testes HTTP de leitura.
- `test-results/aula37-disponibilidade.json`, `test-results/.gitignore`:
  relatório sem registros de pacientes e proteção de backups locais.
- Este relatório e referências atualizadas em `ANA-SUPABASE.md` e `LEIA-ME.md`.

Nenhum arquivo funcional da PWA foi alterado nesta aula.

## Documentação oficial consultada

- [Autenticação e headers das Edge Functions](https://supabase.com/docs/guides/functions/auth-headers)
- [Validação de usuário no servidor e contexto Auth](https://supabase.com/docs/guides/functions/auth-legacy-jwt)
- [Segurança de funções Postgres](https://supabase.com/docs/guides/database/functions#security-definer-vs-invoker)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
