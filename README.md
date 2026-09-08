# Painel do Escritório

Painel de controle processual para escritório de advocacia. Roda inteiro no navegador, sem servidor, sem banco de dados e sem nenhuma dependência externa — nem CDN, nem framework, nem conta em serviço de terceiros.
 
Feito para **Caio Trombini Advocacia · OAB/SP 454.679**, mas o código não tem nada específico do escritório: os dados vivem num arquivo separado.

## O que ele faz

- **Painel** — indicadores do dia, alertas por caso, o que vence nos próximos 45 dias.
- **Casos** — ficha completa: partes, foro, fase, fatos, tese, contatos, prazos e documentos.
- **Agenda** — calendário mensal com tudo junto; duplo clique num dia cria compromisso.
- **Escritório** — compromissos que não pertencem a caso nenhum (atendimentos, reuniões), com calendário próprio e vínculo automático sugerido a um caso quando faz sentido.
- **Pendências** — checklists de instrução por cliente, com progresso.
- **Arquivos** — navegação das pastas dos casos e arrastar-e-soltar que arquiva o documento na subpasta certa, já renomeado no padrão do escritório.
- **Acessos** — controle de quais portais (Meu INSS, e-SAJ, PJe…) cada caso depende, quem detém o acesso e em que situação está. **Sem armazenar senha alguma.**

## Como rodar

Copie `dados-exemplo.js` para `dados.js` e abra `index.html`.

Há dois modos, detectados automaticamente:

| | Aberto por duplo clique (`file://`) | Servido por `https` ou `localhost` |
|---|---|---|
| Ver tudo, agenda, pendências, .ics | sim | sim |
| Arrastar arquivos | vai para uma fila com destino e nome sugeridos | **grava direto na pasta do caso** |
| Navegar pastas dentro do painel | não (o navegador bloqueia) | sim |

O modo completo depende da [File System Access API](https://developer.mozilla.org/docs/Web/API/File_System_Access_API), que o Chrome só libera em contexto seguro. Para rodar localmente com todos os recursos:

```bash
cd painel
python -m http.server 8000
# abra http://localhost:8000
```

Na primeira vez, clique em **Conectar pasta** e autorize a pasta raiz do escritório. A permissão fica guardada e não é pedida de novo.

## Estrutura

```
painel/
  index.html        estrutura da página
  estilo.css        tema claro e escuro
  app.js            toda a lógica (sem dependências)
  dados.js          SEUS DADOS — não versionado
  dados-exemplo.js  exemplo fictício, este sim versionado
```

`dados.js` é a fonte única de verdade. Editar esse arquivo é a única forma de mudar o conteúdo do painel.

O que o usuário marca no navegador — pendências concluídas, prazos confirmados, compromissos do escritório, situação dos acessos, tema — fica em `localStorage`, separado dos dados oficiais. Há botões de backup e restauração para levar isso de uma máquina para outra.

## Sigilo — leia antes de publicar

**`dados.js` nunca deve ir para um repositório.** O `.gitignore` já bloqueia esse arquivo, além de `.ics`, `.pdf`, `.docx` e imagens. Não remova essas linhas.

O motivo é concreto: um painel real contém nome de cliente, telefone, histórico médico, estratégia processual e valor de causa. Publicar isso viola o sigilo profissional (art. 34, VII do Estatuto da Advocacia) e, no caso de dado de saúde, a LGPD trata como dado sensível com regime próprio.

A arquitetura foi desenhada em torno disso: **o programa é público, os dados são locais.** Você pode publicar este repositório sem risco — quem clonar recebe um painel vazio que só ganha conteúdo ao apontar para a pasta da própria pessoa.

O schema de caso não tem (e não deve ganhar) campo de CPF, RG, filiação ou data de nascimento — isso é dado de qualificação para petição, não de acompanhamento processual, e fica fora do painel. Telefone de contato é a exceção: fica em `dados.js` porque alimenta o link de ligar direto da ficha do caso, e `dados.js` já não é versionado.

### Trava de commit

Este repositório vem com um hook de pré-commit (`.githooks/pre-commit`) que recusa qualquer commit cujo diff pareça conter CPF, RG, filiação ou data de nascimento — mesmo que caia sem querer num arquivo versionado. Ative uma vez por clone:

```bash
git config core.hooksPath .githooks
```

## Prazos calculados

Todo prazo gerado automaticamente entra marcado como **estimado**, aparece em amarelo e exige um clique de confirmação. Enquanto não confirmado, conta no aviso do topo e vai para o `.ics` com o prefixo `[ESTIMADO]`.

Isso não é excesso de zelo: prazo processual errado é perda de direito. A marcação existe para que nenhum cálculo automático seja confundido com conferência humana.

Um prazo pode vir de duas formas:

- **Data fixa**: `{ data:"AAAA-MM-DD", ... }` — compromisso com data certa, ou já calculado por fora.
- **Calculado pelo painel**: `{ baseChave:"citacao", diasUteis:15, ... }` — o painel busca `datasBase[baseChave]` no caso e calcula o vencimento sozinho, contando **dias úteis**, excluindo o dia do começo (art. 224, *caput*, do CPC), considerando feriados nacionais, feriados de SP e o recesso forense (art. 220 do CPC, 20/dez a 20/jan). Aparece com o selo "calculado — art. 224 CPC"; passe o mouse para ver a base do cálculo. **Feriados municipais de Botucatu não estão cadastrados** (`FERIADOS_LOCAIS_BOTUCATU` em `app.js`, propositalmente vazio) — preencha só com fonte oficial antes de confiar no cálculo perto de datas de feriado local.

Prazo crítico (`critico:true`) que vence e ninguém dá baixa **não desaparece**: migra para a seção **Prazos vencidos sem desfecho**, no topo do Painel, e só sai de lá quando alguém registra cumprido/perdido/prejudicado/reagendado com justificativa.

## Schema de um caso

```js
{
  id, cliente, clienteObs, titulo, area, parteContraria,
  numeroProcesso,   // formato NNNNNNN-DD.AAAA.J.TR.OOOO; dígito verificador é conferido (CNJ 65/2008)
  foro, fase, status, statusTipo,  // statusTipo ∈ ok|alerta|perigo|info|neutro
  valorCausa, responsavel, pasta,
  datasBase: { chave: "AAAA-MM-DD" },   // ex.: citacao, intimacaoContestacao, publicacaoDecisao, transitoJulgado
  contatos: [ { nome, tel } ],
  resumo, tese,

  // M10 — confirmação de protocolo. tentado_sem_confirmacao há mais de 2
  // dias vira alerta perigo sozinho.
  protocolo: { status, data, recibo, verificadoEm },
  // status ∈ nao_aplicavel | pendente | tentado_sem_confirmacao | confirmado

  alertas: [ { nivel, txt, hash, primeiraVez, ultimaVez, contagem } ],
  // nivel ∈ perigo|alerta|info. hash/primeiraVez/ultimaVez/contagem são
  // opcionais (M09): quando uma auditoria reencontra a mesma condição,
  // deve atualizar ultimaVez/contagem no alerta existente (mesmo hash) em
  // vez de inserir uma entrada nova — o painel mostra "inalterado há N dias".

  prazos: [ { data, hora, titulo, tipo, estimado, critico, nota, baseChave, diasUteis } ],
  pendencias: [ { t, p } ],   // p ∈ alta|media|baixa
  docs: [ "string livre, mas se citar um nome de arquivo a auditoria confere no disco" ]
}
```

O painel valida esse schema ao carregar (`validarDados()` em `app.js`) — campo obrigatório ausente, enum inválido, data fora de `AAAA-MM-DD` ou `id` duplicado barram a troca de dados e mostram exatamente qual caso e campo estão errados, sem derrubar o que já estava carregado.

## Auditoria de disco e novo caso

Na aba **Arquivos**, com a pasta conectada, o botão **Auditar documentos e pastas** compara `dados.js` com o disco de verdade e só relata (nunca move, cria ou apaga nada):

- pasta em `01_CLIENTES` sem caso correspondente, e caso cujo `pasta` não existe no disco;
- entrada de `docs[]` que parece nome de arquivo mas não foi encontrada, e arquivo real que não está listado em nenhum `docs[]`.

Na aba **Casos**, o botão **+ Novo caso** cria de verdade a estrutura de pastas padrão em `01_CLIENTES` (com checagem de nome parecido, para não duplicar cliente) e monta o esqueleto do caso pronto para colar dentro de `casos[]` em `dados.js` — a edição de `dados.js` continua manual, de propósito: não há gravação automática nesse arquivo.

O checkbox **Ordenar por risco** (aba Casos) troca a ordem de cadastro por um score visível: prazo crítico vencido sem desfecho, protocolo sem confirmar, prazo crítico em até 7 dias, pendência alta parada há mais de 14 dias e prescrição em até 90 dias — cada critério aparece na própria linha do caso, nunca escondido.

O botão **Resumo do dia** (aba Escritório) gera `02_CONTROLE/HOJE.md` (grava direto quando a pasta está conectada; baixa o arquivo quando não está) com vencidos sem desfecho, prazos dos próximos 7 dias, protocolos não confirmados e casos parados — sempre até 40 linhas.

## Licença

Código sob licença MIT. Os dados do escritório, obviamente, não.
