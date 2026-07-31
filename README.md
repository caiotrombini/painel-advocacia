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

## Prazos calculados

Todo prazo gerado automaticamente entra marcado como **estimado**, aparece em amarelo e exige um clique de confirmação. Enquanto não confirmado, conta no aviso do topo e vai para o `.ics` com o prefixo `[ESTIMADO]`.

Isso não é excesso de zelo: prazo processual errado é perda de direito. A marcação existe para que nenhum cálculo automático seja confundido com conferência humana.

## Licença

Código sob licença MIT. Os dados do escritório, obviamente, não.
