# Agenda

> **Fin — financeiro da marca:** painel local integrado à mesma Agenda DEV da
> Ana, com leitura financeira, despesas pagas e exportação para o futuro agente.
> A Agenda original não foi alterada. Veja [PREPARACAO-FIN.md](PREPARACAO-FIN.md).

> **Upgrade Fin v2:** conversa offline, projeção do resultado, contas mensais,
> simulações e backup restaurável. Instruções em
> [IMPLEMENTACAO-FIN-V2.md](IMPLEMENTACAO-FIN-V2.md).

> **Aula 3.7:** API autenticada e somente de leitura para disponibilidade no
> Supabase DEV. Contrato e resultados em
> [AULA-3.7-DISPONIBILIDADE.md](AULA-3.7-DISPONIBILIDADE.md). A PWA original não foi alterada.

> **Aula 3.6:** a Ana DEV agora oferece sincronização por ativação explícita,
> com revisão, journal e recuperação de conflitos. Instruções e evidências em
> [AULA-3.6-SINCRONIZACAO.md](AULA-3.6-SINCRONIZACAO.md). Uso exclusivamente fictício.

> **Nesta branch: Ana DEV, somente dados fictícios.** Execute `node preview.mjs`
> e use http://127.0.0.1:43188/ana-dev/. A Ana tem armazenamento, cache, worker e
> identidade PWA separados. Não publique esta branch no endereço da Agenda
> original. Consulte [ISOLAMENTO-ANA.md](ISOLAMENTO-ANA.md). As descrições abaixo
> preservam a documentação da Agenda que serviu de base.

PWA responsiva para organizar atendimentos. Os dados são salvos somente no navegador do dispositivo, usando IndexedDB e localStorage como alternativa.

## Continuar o desenvolvimento em outro computador

Com Git e Node.js 24 instalados, clone a branch de desenvolvimento e inicie a prévia:

```powershell
git clone --branch feat/ana-supabase https://github.com/Domingodecafe/Agenda.git Sec.Ana
cd Sec.Ana
node preview.mjs
```

- [Agenda DEV](http://127.0.0.1:43188/ana-dev/)
- [Console Ana](http://127.0.0.1:43188/ana-dev/ana-console.html)
- [Console Fin](http://127.0.0.1:43188/ana-dev/fin-console.html)

### Chat da Ana e do Fin com IA

Na Agenda DEV, abra **Chat** no cabeçalho e selecione **Ana** ou **Fin**.
A Ana consulta horários livres e agenda pelo chat. Para pedir uma sessão, informe
nome, dia e hora. Com o horário livre, ela salva direto por R$ 200,00, com duração
de 60 minutos e status A receber. A modalidade padrão é Presencial.
O Fin consulta recebimentos de um mês.
Use somente dados fictícios. A conversa e os resultados resumidos das consultas
são enviados à API da OpenAI.

Antes de iniciar a prévia, configure a chave de API e o ID de um modelo
compatível com chamadas de ferramentas na Responses API. No PowerShell 7:

```powershell
$env:OPENAI_API_KEY = Read-Host 'Chave da API da OpenAI' -MaskInput
$env:OPENAI_MODEL = Read-Host 'ID do modelo da OpenAI'
node preview.mjs
```

A configuração vale para esse terminal. Sem ela, a Agenda local continua
disponível e o chat informa o que falta. Guarde a chave fora do repositório.

### Publicar a Agenda DEV no Render

Crie um **Web Service** Node na branch de teste, com o plano **Free**,
comando de build `node --version` e comando de inicialização `node preview.mjs`.
Defina o health check como `/healthz` e as variáveis abaixo no painel do Render:

- `NODE_VERSION` com `24.22.1`.
- `AGENDA_DEV_PASSWORD` com uma senha exclusiva de pelo menos 16 caracteres.
- `OPENAI_API_KEY` com uma chave de API válida.
- `OPENAI_MODEL` com o ID de um modelo com acesso à Responses API e às ferramentas.

O serviço usa `RENDER_EXTERNAL_URL` e `PORT` do Render. Abra `/ana-dev/` no
endereço HTTPS fornecido. A primeira abertura em um navegador recebe 20
clientes e 83 sessões fictícias. As edições permanecem nesse navegador,
independentes da Agenda local do PC. A versão online requer internet.

### Agenda compartilhada 1.0

Valide primeiro em um serviço Render de teste separado. No projeto Supabase
DEV da Secretaria Ana, verifique se `agenda_snapshots` e
`write_agenda_snapshot` já existem e têm as permissões do schema em
`supabase/ana-schema.sql`. Cadastre um usuário Auth exclusivo, com e-mail
confirmado e sem dados associados. A primeira leitura cria somente o cenário
fictício nesse usuário. Uma base existente de outra etapa é recusada.

Além das variáveis da seção anterior, configure no serviço de teste:

- `AGENDA_SHARED=true`
- `AGENDA_SUPABASE_URL` com o endereço HTTPS do projeto DEV.
- `AGENDA_SUPABASE_PUBLISHABLE_KEY` com a chave publishable do projeto.
- `AGENDA_SUPABASE_EMAIL` e `AGENDA_SUPABASE_PASSWORD` com as credenciais
  do usuário Auth dedicado, inseridas diretamente no painel do Render.

Abra o mesmo endereço de teste nos dois aparelhos. Clientes, sessões e
pagamentos são compartilhados. O livro de despesas do Fin é local. Sem
internet, o app avisa e bloqueia a gravação. O cenário local já existente
em cada navegador não é importado para o Supabase.

No chat da Ana, você pode pedir um atendimento avulso, uma série semanal,
quinzenal ou mensal, uma remarcação ou um cancelamento. Identifique o cliente,
a sessão original e o alcance da alteração. A Ana valida a série inteira
antes de salvar. Para apagar sessões, confira a seleção e clique em
**Confirmar exclusão**. O cancelamento preserva os pagamentos registrados.

Rode `node --test tests/*.test.mjs` na raiz para verificar a cópia. Use um perfil
de navegador de teste e dados fictícios. Se precisar transferir registros locais,
use o backup do aplicativo. O Git leva os arquivos versionados do projeto.

### Piloto de voz da Ana e do Fin

No serviço DEV hospedado com `AGENDA_SHARED=true`, configure `AGENDA_VOICE=true` e
`OPENAI_REALTIME_MODEL=gpt-realtime` (ou outro modelo da Realtime API disponível
no projeto da chave). O botão **Iniciar voz** aparece no chat após reiniciar o serviço.
Para desativá-lo, remova `AGENDA_VOICE` ou defina `false`.

Use dados fictícios. O áudio é enviado à OpenAI. A Agenda mantém as mensagens
da sessão em memória e envia aos logs operacionais apenas duração, consumo
informado pela API e estado de falha. Use esses registros e a cobrança do projeto
para medir o custo no piloto.

Valide no Edge para Windows, no Chrome para Android e no Safari para iPhone.
Faça uma consulta e um agendamento com Ana, consulte recebimentos com Fin,
interrompa uma resposta falando e pelo botão, silencie o microfone e feche o chat.
Confirme que pedir uma exclusão e dizer “sim” apenas mantém a revisão na tela.
Negue o acesso ao microfone para validar o retorno ao chat escrito.

O estabelecimento da chamada e a validação de SDP foram adaptados do
[exemplo oficial realtime-server-controlled](https://github.com/openai/openai-agents-js/tree/50f6b68275f0b319fb439705b67c8937e0285604/examples/realtime-server-controlled),
com o aviso MIT em `LICENSE-AGENT-VOICE.txt`.

## Como usar

- Para uma consulta rápida no computador, abra `index.html`.
- Para instalar no celular e usar offline, publique esta pasta em um endereço HTTPS, abra o endereço no navegador do celular e escolha **Adicionar à tela inicial** ou **Instalar aplicativo**.
- Faça backup antes de limpar os dados do navegador, trocar de aparelho ou remover o aplicativo. Esta versão não sincroniza dados entre dispositivos.

## Recursos incluídos

- Agenda em Dia, Semana e Mês.
- Semana completa no celular, com os sete dias visíveis ao mesmo tempo.
- Gestos laterais para navegar por dias, semanas e meses, atravessando automaticamente meses e anos.
- Mês compacto com os sete dias visíveis sem rolagem horizontal.
- Atendimentos, bloqueios, edição, exclusão e remarcação.
- Duração padrão de uma hora, com horário final automático e edição manual.
- Seletores de horário próprios e legíveis no celular, em intervalos de 15 minutos.
- Recorrência semanal, quinzenal e mensal por 12 meses.
- Recorrência editável em atendimentos existentes, com recálculo das próximas sessões.
- Edição com escolha entre somente a ocorrência selecionada ou esta e todas as futuras.
- Exclusão separada para uma ocorrência ou para esta e todas as futuras da sequência.
- Novos horários escolhidos pela grade começam na hora cheia do bloco; ajustes manuais continuam em intervalos de 15 minutos.
- Cadastro simples de clientes e valor padrão.
- Campo de observações no cadastro de clientes.
- Cores por cliente e por atendimento: verde, amarelo, vermelho, roxo e azul.
- Todo novo atendimento começa em verde, com possibilidade de troca manual.
- Status clínico e financeiro separados.
- Resumo financeiro mensal.
- Clientes pendentes e parciais aparecem antes dos clientes pagos no Resumo.
- A lista mensal mostra dez clientes por vez, com carregamento incremental.
- O tipo Outro funciona como compromisso particular sem custo e não entra nos cálculos financeiros.
- Resumo mensal agrupado por cliente, com histórico completo de sessões passadas e futuras.
- Recebimento em lote para marcar vários atendimentos pendentes como pagos em uma única operação.
- Alteração financeira em lote para A receber, Pago ou Não pago, inclusive em sessões já pagas.
- No celular, ações financeiras aparecem entre os atendimentos passados e futuros sem cobrir a navegação.
- Um toque na data seleciona a sessão; dois toques abrem o atendimento na visão Dia da Agenda.
- O Resumo abre em Para receber: reúne todas as sessões encerradas sem pagamento, de qualquer mês, por cliente. A descrição usa frases como 3 pagas · 1 sem pagamento.
- Recebidos mostra sessões pagas pela data do pagamento no mês escolhido, com data e forma nos detalhes. Registros antigos sem data ficam acessíveis separadamente, sem atribuir uma data fictícia nem incluí-los nos totais mensais.
- Próximas sessões mostra sessões futuras ou em andamento do mês escolhido, inclusive antecipações, identificando as já pagas.
- Tocar no cliente abre as sessões da visão escolhida; Ver histórico completo dá acesso a todos os atendimentos. Seleção e recebimento em lote permanecem disponíveis.
- Os cabeçalhos da semana abrem a visão Dia, preservando a posição vertical.
- A versão v30 aparece junto à marca; novas versões oferecem o botão Atualizar após baixar, sem descartar formulários abertos. A verificação ocorre ao abrir, retornar ao app ou recuperar a conexão.
- As listas do Financeiro são atualizadas a cada minuto enquanto estiverem abertas. Bloqueios e compromissos Outro ficam fora de todas as visões.
- O botão de olho no Resumo e no histórico oculta todos os valores dessas telas, inclusive o total selecionado. A preferência fica salva no aparelho; edição e confirmação de pagamento continuam mostrando os valores.
- Pagamentos registram data, forma (PIX, Dinheiro ou Outro) e descrição opcional.
- Pagamentos em lote são preenchidos sessão por sessão e gravados juntos após confirmação.
- Correções e reversões financeiras preservam um histórico auditável dentro da edição da sessão.
- Se uma versão antiga não exibir o aviso de atualização, feche todas as janelas da Agenda e reabra conectada à internet. Não limpe os dados do navegador.
- Interface simplificada sem status clínico e sem fluxo separado de remarcação.
- Funcionamento offline após a primeira abertura em um endereço HTTPS.
- Transições suaves entre telas, abas, calendários e modais, respeitando a preferência de redução de movimento do aparelho.
- Voltar do histórico financeiro retorna ao cliente selecionado na lista, inclusive após reordenação por pagamentos.
- Tema Grafite & Menta: fundo uniforme, navegação com ícones, controles legíveis e Resumo compacto com Recebido em destaque.
