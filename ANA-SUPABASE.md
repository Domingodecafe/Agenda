# Integração Ana + Supabase (preparação)

## Aula 3.7 — API de leitura atual

`consultar_disponibilidade` está implementada no Supabase DEV com autenticação
obrigatória e projeção de horários dentro do banco, sem entregar snapshots a
serviços externos. Consulte [AULA-3.7-DISPONIBILIDADE.md](AULA-3.7-DISPONIBILIDADE.md)
para contrato, segurança, demonstração, testes e limites. Não há escrita de
agendamentos por essa API nem conexão com n8n/IA/WhatsApp.

## Aula 3.6 — implementação atual

Sincronização automática **opt-in** implementada na Ana DEV. Leia
[AULA-3.6-SINCRONIZACAO.md](AULA-3.6-SINCRONIZACAO.md) para ativação, recuperação,
conflitos, limites e resultados. Os relatos de transferência manual abaixo são
históricos. Não executar seus passos de envio inicial para substituir snapshots
existentes. A versão atual exige decisão explícita entre fontes diferentes.

## Ambiente atual — Ana DEV isolada

Leia [ISOLAMENTO-ANA.md](ISOLAMENTO-ANA.md) antes de executar esta branch.
Agora use **http://127.0.0.1:43188/ana-dev/** com `node preview.mjs`.
Banco, localStorage, sessão Auth, cache, escopo do worker e instalação PWA têm
identificadores exclusivos. A nova origem inicia vazia, sem migração. O snapshot
remoto fictício do teste anterior permanece intacto. Nenhum deploy foi feito;
as seções de preparação e teste abaixo são históricas.

## Atualização — teste fictício concluído em 22/10/2026

Cadastro, sessão de 60 minutos, persistência local, exportação de backup e envio
inicial foram testados com um único paciente fictício e valor zero. O Supabase
confirmou revisão 1 e payload igual ao backup. A conta utilizada agora contém
esse snapshot de teste; não há sincronização automática. Nenhum dado real foi
utilizado. Relatório atual: [TESTE-BACKUP-ANA.md](TESTE-BACKUP-ANA.md).
Os resultados parciais abaixo documentam a preparação anterior a esse envio.

## Isolamento do projeto
Em 22/10/2026 foi confirmado o projeto dedicado **Secretaria Ana**, referência `dpdxzbbzymkygutwefww`, ativo. A tabela `agenda_snapshots`, suas políticas RLS e a função `write_agenda_snapshot` já existem. Não reaplique o SQL nesta etapa. Não use o projeto base LADO A. Consulte `PREPARACAO-ANA.md` para o teste local sem gravações remotas.

## A implementação
- `supabase/ana-schema.sql`: tabela `agenda_snapshots` com RLS, titularidade por `auth.uid()` e função `write_agenda_snapshot` com revisão otimista. O documento JSON preserva os arrays `clients`, `appointments` e `settings` e todos os campos atuais (recorrências, pagamentos, bloqueios etc.).
- `cloud-sync.js`: cliente Supabase JS fixado na versão 2.49.1 (carregado só quando necessário), autenticação por e-mail/senha e transferência manual (envio inicial e download de cópia), sem sincronização contínua.
- `app.js` e `index.html`: exportação de backup; configuração de Supabase; exportação local; envio inicial sem sobrescrever estado remoto e download remoto para arquivo. A agenda CONTINUA local; não existe modo nuvem de edição.

## Configuração original (referência; não executar nesta primeira etapa)
1. Crie projeto Supabase privado/dedicado, habilite Data API para `public` e configure Supabase Auth. Desabilite auto-cadastro público (signup). Cadastre manualmente um usuário administrador verificado, com senha forte e MFA quando possível.
2. No SQL Editor do projeto dedicado, aplique `supabase/ana-schema.sql`. Verifique tabelas e políticas RLS, e execute os advisors de segurança.
3. Hospede o aplicativo sob HTTPS, abra `Nuvem`, informe **Project URL** e uma **publishable key** (não `service_role` / `secret`!), faça login com sua conta.
4. Clique `Exportar backup` e guarde o JSON **localmente e criptografado**; os dados incluem prontuário administrativo e financeiro.
5. Envie explicitamente uma cópia inicial pelo botão `Enviar cópia local`. O sistema recusa sobrepor um registro remoto já existente. Em outros dispositivos, use `Baixar cópia da nuvem` apenas para exportar um arquivo; ainda não há importação nem sincronização automática.
6. Verifique clientes/atendimentos e alterações em ambiente de teste antes de habilitar dados reais.

## Limitações e etapas necessárias antes de pacientes reais
- Não foi feito deploy e **a Ana ainda não tem permissão de editar via WhatsApp**. O n8n precisará de um backend próprio (Edge Function autenticada ou servidor com credencial secreta protegida), sem entregar chaves privilegiadas à IA ou ao navegador.
- O formato por snapshot simplifica compatibilidade com o PWA atual, mas para múltiplos editores simultâneos e reservas robustas será necessário migrar para tabelas normalizadas de pacientes/atendimentos, verificar colisões **transacionalmente** no servidor e limitar os campos lidos pela Ana (principalmente observações e finanças).
- A aplicação existente não valida colisões de horários de forma transacional. **Não autorize agendamento automático real pela Ana** antes dessa implementação.
- Dados no IndexedDB/localStorage continuam existindo neste dispositivo como cópia local. O backup exportado não é criptografado; proteja-o fora do aplicativo.
- No estágio atual, a edição do app permanece local, independente da nuvem. Nunca considere o backup remoto automaticamente atualizado após editar o aplicativo. Não force uma substituição de dados remotos.
- Validação de contatos desconhecidos: pendente de implementação no backend da Ana, conforme Regra 10.
- Como testar: use apenas dados fictícios, teste cadastro, editar, exclusão, recorrências, recarregar aba, atualizar em outro aparelho e perda de rede. Confirme revisões e RLS com dois usuários de teste.

## Referências
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/auth
- https://supabase.com/docs/reference/javascript/installing
- https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys

## Estado real da branch
- Entrega parcial, com possibilidade de login, backup local, envio inicial e download da cópia remota; **não é ainda uma agenda multi-dispositivo**.
- O arquivo JS da interface carrega o SDK Supabase via CDN apenas quando o usuário tenta se conectar; se estiver offline, as operações remotas não funcionam.
- Revisões impedem substituição do primeiro backup remoto, mas o próximo passo exige sincronização bidirecional e migração de formato antes de operação com a Ana.
- Em 22/10/2026 a abertura do painel, configuração pública e bloqueio de consulta sem login foram verificados em navegador local. A estrutura remota foi consultada sem ler dados de pacientes. Login administrativo e consulta autenticada de metadados foram validados, retornando ausência de snapshot para a conta. Gravação, download autenticado e isolamento entre dois usuários ainda não foram validados. Veja `PREPARACAO-ANA.md`.
