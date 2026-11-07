# Ana — implementação local do prompt mestre

28/10/2026. A solicitação atual retomou implementação e testes locais. As
instruções históricas de pausa do prompt foram preservadas no documento original;
não são tratadas como uma proibição de executar o pedido atual.

## Abrir

Execute `node preview.mjs` nesta pasta e acesse:

http://127.0.0.1:43188/ana-dev/ana-console.html

O painel possui conversa de teste, cadastros, permissões de contatos vinculados,
sessões, reservas, fila, encaminhamentos e auditoria. Cadastre somente pessoas
fictícias. Para testar uma operação que o interpretador não reconheça, abra
**Operação estruturada**, selecione a operação e preencha os campos. IDs de
sessões e reservas aparecem na seção **Sessões e reservas**.

As ações administrativas representam Henrique operando o computador local.
O número digitável é um recurso do simulador, não autenticação de pacientes.
Este painel não deve ser exposto como uma API ou portal público.

## Arquitetura e isolamento

- `ana-policy.js`: motor determinístico, sem chamadas externas. Recebe estado,
  operação identificada e relógio; devolve novo estado e resposta.
- `ana-local-store.js`: leitura, verificação de permissões, conflitos,
  idempotência e gravação dentro de uma única transação IndexedDB. A UI só
  apresenta a confirmação depois de `transaction.oncomplete`.
- `ana-console.html`, `.css`, `.js`: painel local e interpretador limitado.
- Banco Ana existente `ana-dev-agenda-db-v1`, store `ana-dev-agenda`, chave nova
  **`ana-dev-assistant-v1`**. A chave `ana-dev-main` da agenda não é consultada
  nem modificada pelo laboratório. Não há importação de pacientes antigos.
- Não há fallback silencioso neste laboratório: falha de persistência impede
  confirmação. Repetir a mesma operação com o mesmo `requestId` não a duplica.
- `networkEnabled: false` faz o módulo da nuvem retornar antes de ler
  configuração ou restaurar autenticação. O servidor local também restringe
  conexões e scripts externos por CSP. Essas restrições precisam de revisão
  explícita antes de qualquer futura conexão.
- Cache Ana passou a v6, incluindo os arquivos do laboratório. Nenhum cache
  original foi enumerado ou removido. Uma PWA antiga já aberta pode precisar
  aplicar a atualização antes de carregar a nova agenda; o laboratório novo
  não carrega o módulo da nuvem.

## Regras implementadas no motor local

| Área | Comportamento |
| --- | --- |
| Identidade | Apresentação como IA, informações gerais, Pix, áudios sem transcrição, encaminhamento de anexos sem interpretação |
| Permissões | Identificação pelo número, número próprio único, vínculos por Henrique, financeiro independente de agendamento, desconhecidos sem acesso individual |
| Menores | Primeira resposta administrativa e conversa humana; automação posterior suspensa |
| Agenda | Expediente, 60 minutos, antecedência de 2h, bloqueios, sobreposições, até três opções |
| Operações | Agendar, duas consecutivas com valores separados, remarcar atomicamente, trocar modalidade, consultar sessões, cancelar próxima/data/ID/todas |
| Histórico | Cancelamentos preservam sessões e registros financeiros; inativação/retorno não restauram frequência |
| Recorrência | Mudança permanente encaminhada; semanal com sessão na semana de destino pede decisão sobre extra; quinzenal em outra semana mantém original |
| Espera | Uma reserva por paciente, prazo menor entre 30min e limite de 2h, exclusividade, recusa, saída, expiração, rotação da fila, revogação e bloqueio |
| Cancelamentos | Vaga liberada prepara oferta local ao próximo elegível; sessão extra não gera pergunta de remarcação; espera de resposta expira silenciosamente |
| Financeiro | Sem baixa por alegação/comprovante; valor individual, fallback 200 com alerta; dados individuais somente com permissão |
| Controle humano | Assumir/devolver por contato, supressão de mensagens pendentes, retorno aguarda mensagem nova |
| Presença | Confirmação por destinatário autorizado; divergência bloqueia alterações até Henrique resolver |
| Lembretes | Preparação local exatamente no instante de 24h; nenhuma campanha atrasada; registros não equivalem a envio |
| Encaminhamentos | Pendências, resolução no painel, alertas administrativos de sofrimento, auditoria de autor e paciente |

## Limites e trabalho necessário antes do uso real

O prompt completo **ainda não está integralmente implementado**. Esta entrega é
um laboratório funcional do motor; não é uma secretária conectada ou uma nova
agenda de produção.

1. Integrar o motor à agenda existente com mapeamento e validação dos campos;
   hoje as duas áreas mantêm estados separados intencionalmente. Recorrências
   materiais, baixas financeiras e operações manuais da agenda não são
   sincronizadas para o laboratório. Configurar frequência aqui não gera séries.
2. Expandir a interpretação de linguagem: datas relativas, solicitação com
   múltiplas intenções, coleta progressiva de primeiro atendimento, seleção de
   pacientes por nome entre vários vínculos e retorno à remarcação depois de
   cancelamento ainda exigem campos/operações explícitos ou encaminhamento.
   O parser não é um modelo de linguagem. Não se deve usar números digitados
   pelo próprio cliente como prova de identidade em um canal real.
3. Prazos são reavaliados durante operações ou pelo botão **Processar prazos
   agora**. Não existe serviço ativo com a janela fechada. Lembretes no horário
   exato requerem agendador persistente; o teste unitário usa relógio controlado.
   Na prática, clicar manualmente depois do instante exato não prepara lembrete.
4. Conectar canais autenticados de atendimento e alertas, comprovantes de
   entrega, retomada de falhas e proteção do servidor. `outbox.status=local-only`
   nunca significa mensagem entregue. Nenhum acúmulo deve ser enviado ao
   conectar um canal no futuro.
5. Completar as condições editoriais e exceções do prompt: oferecer alternativas
   e avisar Henrique em todos os casos de antecedência insuficiente; revisão de
   conflitos de presença após cancelamento já concluído; prioridade de vários
   vínculos; oferta automática de vaga aberta manualmente; comandos mistos.
6. Relatos de sofrimento usam a preferência administrativa de intervalo de 24h
   para simulação, sem contato de emergência nem alerta externo. Isso não é um
   protocolo de segurança validado e não substitui as regras de segurança de
   um futuro modelo ou serviço.

## Verificação local

```powershell
node --test tests/policy.test.mjs tests/isolation.test.mjs tests/sync.test.mjs tests/availability.test.mjs
```

Os testes de sincronização e disponibilidade usam substitutos locais; não são
os arquivos `*.integration.mjs`, que acessam serviços remotos e não foram
executados nesta etapa. Nenhum SQL foi aplicado, commit criado, push executado
ou publicação realizada.

Resultado desta entrega: 66 testes aprovados, nove verificações HTTP no
loopback aprovadas e validação no navegador de cadastro, consulta de horários,
agendamento, persistência após recarga, recusa de sobreposição e consulta da
próxima sessão. Evidência visual: `test-results/ana-local.jpg`. O navegador de
teste contém somente `TESTE Ana Local`, número e sessão fictícios.
