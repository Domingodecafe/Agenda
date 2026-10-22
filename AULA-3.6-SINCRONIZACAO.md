# Ana DEV — Aula 3.6 — 22/10/2026

## Entrega

Sincronização automática por snapshot implementada **somente para testes com
dados fictícios** em `http://127.0.0.1:43188/ana-dev/`. Ativação por sessão e
decisões de recuperação são explícitas. Não há WhatsApp, n8n, IA ou agendamento
automático. A Agenda original e sua publicação não foram modificadas.

## Como ativar

1. Execute `node preview.mjs` e abra o endereço Ana DEV acima.
2. Se aparecer Atualização disponível, feche formulários e use Atualizar
   **somente na Ana DEV**. Não limpe armazenamento ou caches do navegador.
3. Em Nuvem / Ana, configure a URL do projeto Secretaria Ana e sua chave pública
   `sb_publishable_`. Digite e-mail/senha no painel e use Entrar.
4. O login consulta a revisão, sem substituir ou enviar a agenda.
5. Use Ativar sincronização. Se as fontes diferirem, escolha explicitamente
   Ativar usando cópia remota ou Ativar usando cópia local e confirme no painel.
   Para continuar os testes existentes, prefira a cópia remota fictícia.
6. Alterações são salvas localmente e transmitidas após breve espera. Somente
   a resposta do servidor permite mostrar Sincronizado. A revisão aparece no
   painel. Consultas periódicas verificam mudanças feitas por outras instâncias.
7. Ao reabrir ou autenticar novamente, a sincronização começa desativada.
   Pendências e a revisão de origem continuam armazenadas. Renove a ativação.

Desativar sincronização impede novas requisições; uma requisição já enviada
não pode ser cancelada com garantia e pode terminar. O painel aguarda sua
conclusão antes de logout/reconfiguração. Sair não apaga cópias locais.

## Conflitos, offline e recuperação

- Cada gravação usa `write_agenda_snapshot` com a revisão esperada, sem upsert
  direto. Duas instâncias concorrentes não podem ambas confirmar a mesma revisão.
- Se a revisão remota mudar, o motor pausa em Conflito. Não mescla dados nem
  substitui fontes automaticamente. Alterações seguintes continuam locais.
- Para resolver, exporte o backup local e use Ativar sincronização para consultar
  novamente e escolher uma fonte. A escolha é invalidada se qualquer fonte mudar
  enquanto o usuário decide. Usar a fonte local substitui integralmente o
  snapshot remoto somente após essa decisão, ainda sujeito ao CAS do servidor.
- Recuperar cópia remota exige confirmação, preserva cópia local anterior e
  mantém a sincronização desativada. Exportar cópia remota só baixa um arquivo.
- Cópias locais de recuperação contém os journals e arquivos anteriores da Ana.
  Selecione uma e use Restaurar cópia local selecionada. A atual é arquivada e
  não ocorre transmissão automática após restaurar. Cópias vinculadas a outra
  conta não são restauradas por uma conta diferente.
- Offline, as alterações permanecem pendentes. Ao reconectar, a revisão é
  consultada antes de qualquer envio. Em erro de servidor, o journal permanece;
  use Tentar sincronizar novamente ou aguarde a próxima tentativa controlada.
- Se a resposta de um commit se perder, a tentativa registrada é comparada com
  a revisão e o conteúdo remoto antes de reconhecer o commit. Não se incrementa
  uma nova revisão apenas para repetir o mesmo conteúdo.

## Proteção local e coordenação

Dados e metadados de revisão são persistidos no **mesmo envelope** IndexedDB
Ana (ou no fallback próprio). Um marcador próprio impede que a reabertura use
um IndexedDB antigo quando a gravação mais recente precisou do fallback.
Cada instância também mantém journal próprio em localStorage, para uma aba não
eliminar silenciosamente a cópia editada por outra. BroadcastChannel avisa outras
abas sobre commits e Web Locks coordena o envio local quando disponível. O CAS
do servidor continua sendo a proteção obrigatória entre dispositivos.

Identificadores originais da Ana preservados: origem, `/ana-dev/`,
`ana-dev-agenda-db-v1`, `ana-dev-agenda-state-v1`, configuração e sessão Auth.
Novos recursos são exclusivamente `ana-dev-sync-draft-v1-*`,
`ana-dev-sync-archive-v1-*` e `ana-dev-agenda-fallback-active-v1`.
O cache atual é `ana-dev-pwa-v5`, com oito arquivos da PWA. Caches antigos não
foram removidos. A identidade da PWA continua Ana DEV.

## Banco de desenvolvimento

Foi aplicado `supabase/ana-sync-hardening.sql` **somente** ao projeto
`dpdxzbbzymkygutwefww`: validação estrita dos campos JSON e trigger que exige
revisão inicial 1, avanço de uma revisão por atualização e proprietário imutável.
Também foi atualizada a validação de entrada da função RPC, preservando
SECURITY INVOKER, RLS, search_path vazio, assinatura e controle de revisão.
`supabase/ana-schema.sql` contém a validação correspondente para instalações
novas; depois dele deve ser aplicado o hardening. Não reaplique as políticas
do script inicial a um banco existente sem revisar o procedimento.

Não há acesso anônimo a SELECT ou RPC: ambos retornaram HTTP 401 no teste.
Os testes negativos do CHECK e do trigger foram revertidos por subtransações,
sem avançar a revisão. A gravação autenticada foi testada depois do reforço.

O banco ainda permite gravações diretas autenticadas do proprietário; o trigger
impede atualizações que não avancem a revisão, mas a aplicação usa exclusivamente
o RPC. Antes de integrações não confiáveis, deve-se restringir a superfície de
escrita a um backend apropriado e às permissões administrativas necessárias.

## Testes e evidências

`node --test tests/isolation.test.mjs tests/sync.test.mjs`: **29 testes aprovados**.
Cobertura: isolamento, fallback, envelope atômico, confirmação de fontes,
ausência de transmissão sem login/ativação, operações de agenda, edição durante
envio, CAS, offline, erro 503, resposta perdida, reabertura, invalidação de decisão,
desativação em andamento, falha de armazenamento e bloqueio de troca de conta.

`tests/supabase.integration.mjs`: **11 verificações de integração aprovadas**
com duas autenticações independentes, usando o motor real e o RPC real. As
credenciais foram fornecidas apenas em memória, sem eco e sem salvar no código.
Relatório agregado sem credenciais: `test-results/aula36-integracao.json`.

| Operação de integração | Revisão confirmada |
| --- | --- |
| Estado fictício inicial | 1 |
| Criar paciente | 2 |
| Criar atendimento | 3 |
| Alterar horário | 4 |
| Cancelar atendimento | 5 |
| Criar série semanal | 6 |
| Alterar ocorrências futuras | 7 |
| Reabrir e recuperar em segunda sessão | 7 |
| Reconectar e enviar pendência | 8 |
| Recuperar de erro 503 e enviar | 9 |
| Duas RPCs reais com mesma revisão | 10: uma aceita, outra em Conflito |

Na integração, indisponibilidade de rede e erro 503 foram **simulados no driver**;
as gravações após recuperação foram reais. Não foi desligada a rede do sistema
nem derrubado o serviço Supabase. O conflito usou duas requisições concorrentes
reais, sem simular a rejeição. A cópia perdedora foi preservada localmente em
`test-results/conflito-local-ficticio.json`, excluída do Git. Há também cópia
fictícia anterior aos testes nessa pasta, excluída do Git.

Validação pela interface: login consultou revisão 10 sem importar; a ativação
apresentou escolha entre fontes e recuperou a fonte remota mediante confirmação.
O formulário criou paciente (revisão 11), sessão (12), remarcou (13), cancelou
(14) e alterou três ocorrências futuras da série (15). Todas foram conferidas no
Supabase. A sessão cancelada não permaneceu no snapshot e tinha valor zero.
O teste de bloqueio revelou um fechamento de div ausente no HTML preexistente,
que ocultava os botões junto aos campos de atendimento. A correção foi aplicada
somente à Ana e recebeu teste de regressão.

Depois da correção, o formulário criou um bloqueio fictício das 16h às 17h,
confirmado na **revisão 16**, já com o trigger de revisão ativo. Estado final:
três cadastros fictícios, sete itens de agenda (sessões e bloqueios), todos sem
cobrança real. O cadastro fictício inicial foi preservado. O logout do painel
usa escopo local, sem encerrar sessões independentes de outros dispositivos.

Backup final exportado pelo navegador:
`C:\Users\Rickn\Downloads\ana-dev-backup-2026-10-22T14-12-11-056Z.json`.
Uma comparação JSONB do conteúdo completo confirmou igualdade com o payload da
revisão 16 no Supabase. Essa cópia contém exclusivamente os registros fictícios
de teste. Nenhum arquivo com credenciais foi criado no repositório.

Após instalar a versão final no navegador, o diagnóstico de isolamento aprovou
novamente as **6 verificações**, com cache exclusivo `ana-dev-pwa-v5` e 8/8
arquivos. O logout da sessão de teste foi confirmado. A `main` remota permaneceu
em `d4051cc283bda20674e9e579bdfadc24f8feaf3c`, sem alteração de publicação.

## Limitações antes de uso real

Esta entrega não está liberada para pacientes reais. Snapshots inteiros produzem
conflitos de agenda inteira, não oferecem reserva transacional por horário e
incluem campos financeiros/observações. Os journals e backups locais não são
criptografados e não têm expurgo automático. São necessários backend de menor
privilégio, auditoria administrativa, modelo normalizado/reservas transacionais,
política de retenção e validação em dispositivos físicos antes do uso clínico.
Não foi realizado ensaio completo offline em celular nem ensaio de RLS entre
dois usuários diferentes; as duas sessões de conflito pertenciam ao mesmo dono.

O advisor manteve o aviso prévio de proteção contra senhas vazadas desativada:
https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
Essa configuração de conta não foi alterada.

## Arquivos desta etapa

- `ana-sync-engine.js`: motor de sincronização e conflitos.
- `cloud-sync.js`: integração Supabase, consentimento, recuperação, indicadores,
  journals, coordenação de abas e retry controlado.
- `app.js`: persistência de dados/revisão juntos e notificação de alterações.
- `ana-environment.js`: namespaces de journals/fallback e versão de cache.
- `index.html`, `styles.css`, `sw-ana-dev.js`, `preview.mjs`: motor na PWA,
  indicador, cache atualizado, servidor e correção dos formulários.
- `verificar-isolamento.html/js`: diagnóstico atualizado para oito arquivos.
- `supabase/ana-schema.sql`, `supabase/ana-sync-hardening.sql`: validação e guard.
- `tests/isolation.test.mjs`, `tests/sync.test.mjs`,
  `tests/supabase.integration.mjs`: testes locais e de integração.
- `test-results/.gitignore`, `test-results/aula36-integracao.json`: relatório
  agregado versionado; backups de recuperação ficam fora do Git.
- Este relatório e documentação de entrada atualizada.

Mudanças anteriores de isolamento e relatórios de preparação também são salvos
na mesma branch de desenvolvimento. Sem push, merge ou deploy da produção.
