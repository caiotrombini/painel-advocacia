/* ==========================================================================
   ARQUIVO DE EXEMPLO — dados fictícios, seguro para versionar no Git.

   O painel carrega `dados.js`, que NÃO vai para o repositório (veja .gitignore).
   Este arquivo existe para que quem clonar o projeto consiga rodá-lo:
   basta copiar para `dados.js` e substituir pelo conteúdo real.

   Mostra também o schema completo, incluindo os campos do plano de
   melhorias: protocolo (M10), prazo calculado por baseChave/diasUteis
   (M13) e alerta deduplicado com hash/primeiraVez/ultimaVez (M09).
   ========================================================================== */
window.DADOS = {
  meta: {
    escritorio: "Escritório de Advocacia",
    oab: "OAB/UF 000.000",
    atualizadoEm: "2026-01-01T09:00:00-03:00",
    raiz: "C:/Caminho/Para/ADVOCACIA"
  },

  pastas: [
    { nome:"00_MODELOS",       caminho:"C:/Caminho/Para/ADVOCACIA/00_MODELOS",       desc:"Modelos de peças" },
    { nome:"01_CLIENTES",      caminho:"C:/Caminho/Para/ADVOCACIA/01_CLIENTES",      desc:"Uma pasta por cliente/ação" },
    { nome:"02_CONTROLE",      caminho:"C:/Caminho/Para/ADVOCACIA/02_CONTROLE",      desc:"Painel, planilha e agenda" },
    { nome:"03_ARQUIVO MORTO", caminho:"C:/Caminho/Para/ADVOCACIA/03_ARQUIVO MORTO", desc:"Casos encerrados" }
  ],

  casos: [
    {
      id: "exemplo-civel",
      cliente: "Cliente Exemplo",
      clienteObs: null,
      titulo: "Ação de Cobrança — exemplo para demonstração",
      area: "Cível",
      parteContraria: "Parte Contrária Exemplo Ltda.",
      numeroProcesso: null,
      foro: "Vara Cível — a definir",
      fase: "Pré-ajuizamento",
      status: "Em instrução",
      statusTipo: "alerta",
      valorCausa: 50000,
      responsavel: "Advogado Responsável",
      pasta: "C:/Caminho/Para/ADVOCACIA/01_CLIENTES/Cliente Exemplo - Acao de Cobranca",
      datasBase: { fatoGerador:"2025-06-01" },
      contatos: [ { nome:"Cliente Exemplo", tel:"+55 00 00000-0000" } ],

      resumo: "Descrição dos fatos em ordem cronológica, em três a seis frases. Este é um registro fictício, incluído apenas para demonstrar a estrutura de dados esperada pelo painel.",
      tese: "Fundamento jurídico escolhido e a razão da escolha.",

      // M10: status estruturado de protocolo. Enum: nao_aplicavel | pendente
      // | tentado_sem_confirmacao | confirmado. "tentado_sem_confirmacao"
      // há mais de 2 dias vira alerta perigo automaticamente.
      protocolo: { status:"nao_aplicavel", data:null, recibo:null, verificadoEm:null },

      alertas: [
        // M09: quando a mesma condição é reencontrada em auditorias
        // seguidas, atualiza ultimaVez/contagem em vez de inserir linha
        // nova — o painel mostra "inalterado há N dias".
        { nivel:"alerta", txt:"<strong>Exemplo de alerta.</strong> Aceita HTML simples como negrito.",
          hash:"exemplo-alerta-generico", primeiraVez:"2026-01-05", ultimaVez:"2026-01-08", contagem:3 },
        { nivel:"info",   txt:"Exemplo de observação informativa." }
      ],

      prazos: [
        { data:"2026-02-10", hora:"14:00", titulo:"Reunião com o cliente", tipo:"Reunião", estimado:false, critico:true,
          nota:"Compromisso com data certa — não é estimativa." },
        { data:"2028-06-01", titulo:"Prescrição — conferir a norma aplicável", tipo:"Prescrição", estimado:true,
          nota:"Prazo calculado automaticamente. Marcado como estimado: exige conferência antes de qualquer decisão processual." }
      ],

      pendencias: [
        { t:"Documento essencial a obter com o cliente", p:"alta" },
        { t:"Providência de prioridade intermediária",   p:"media" },
        { t:"Item acessório",                            p:"baixa" }
      ],

      docs: [ "Documentos do caso e o que ainda falta arquivar" ]
    },
    {
      id: "exemplo-prazo-calculado",
      cliente: "Cliente Exemplo — Prazo Calculado",
      clienteObs: null,
      titulo: "Ação Trabalhista — exemplo de prazo calculado (M13)",
      area: "Trabalhista",
      parteContraria: "Empregadora Exemplo S.A.",
      // Dígito verificador correto para esta sequência/ano/justiça/tribunal/origem
      // fictícios (módulo 97 base 10, Resolução CNJ 65/2008) — passa na validação.
      numeroProcesso: "1012474-35.2024.8.26.0079",
      foro: "Vara do Trabalho — Botucatu/SP",
      fase: "Contestação",
      status: "Aguardando contestação",
      statusTipo: "alerta",
      valorCausa: 30000,
      responsavel: "Advogado Responsável",
      pasta: "C:/Caminho/Para/ADVOCACIA/01_CLIENTES/Cliente Exemplo - Prazo Calculado",
      // M14: sem "citacao" aqui, o painel geraria pendência alta cobrando
      // essa data. Preenchida para o prazo abaixo poder ser calculado.
      datasBase: { citacao:"2026-08-03" },
      contatos: [],
      resumo: "Caso fictício só para mostrar o motor de cálculo de prazo (dias úteis, art. 224 do CPC, recesso forense).",
      tese: "",
      protocolo: { status:"nao_aplicavel", data:null, recibo:null, verificadoEm:null },
      alertas: [],
      prazos: [
        // M13: sem data fixa — baseChave + diasUteis é que definem o
        // vencimento real, contado em dias úteis a partir de datasBase.citacao.
        { titulo:"Contestação", tipo:"Contestação", baseChave:"citacao", diasUteis:15, critico:true,
          nota:"Calculado a partir da citação — confira o prazo antes de protocolar." }
      ],
      pendencias: [],
      docs: []
    },
    {
      id: "exemplo-vencido",
      cliente: "Cliente Exemplo — Prazo Vencido",
      clienteObs: null,
      titulo: "Ação Cível — exemplo de prazo vencido sem desfecho (M15)",
      area: "Cível",
      parteContraria: "Parte Contrária Exemplo 2",
      // Dígito verificador propositalmente errado (deveria ser 35, não 06)
      // — demonstra o alerta do M11 pegando erro de digitação.
      numeroProcesso: "1012474-06.2024.8.26.0079",
      foro: "Vara Cível — a definir",
      fase: "Instrução",
      status: "Prazo vencido — revisar",
      statusTipo: "perigo",
      valorCausa: null,
      responsavel: "Advogado Responsável",
      pasta: "C:/Caminho/Para/ADVOCACIA/01_CLIENTES/Cliente Exemplo - Prazo Vencido",
      datasBase: {},
      contatos: [],
      resumo: "Caso fictício com um prazo crítico que já venceu e ainda não tem desfecho registrado — fica preso na seção VENCIDOS até alguém registrar cumprido/perdido/prejudicado/reagendado.",
      tese: "",
      protocolo: { status:"tentado_sem_confirmacao", data:"2025-12-20", recibo:null, verificadoEm:null },
      alertas: [],
      prazos: [
        { data:"2026-01-05", titulo:"Manifestação sobre laudo pericial", tipo:"Manifestação", estimado:false, critico:true,
          nota:"Exemplo — vencido de propósito para demonstrar a trilha de vencidos." }
      ],
      pendencias: [],
      docs: []
    },
    {
      id: "exemplo-database-faltante",
      cliente: "Cliente Exemplo — Data-base Faltante",
      clienteObs: null,
      titulo: "Ação Trabalhista — exemplo de data-base faltante (M14)",
      area: "Trabalhista",
      parteContraria: "Empregadora Exemplo 2 S.A.",
      numeroProcesso: null,
      foro: "Vara do Trabalho — Botucatu/SP",
      fase: "Contestação",
      status: "Aguardando contestação",
      statusTipo: "perigo",
      valorCausa: null,
      responsavel: "Advogado Responsável",
      pasta: "C:/Caminho/Para/ADVOCACIA/01_CLIENTES/Cliente Exemplo - Data-base Faltante",
      // Fase de contestação sem a data de citação registrada: o painel
      // não consegue calcular o prazo e precisa cobrar isso sozinho —
      // ausência de prazo aqui não é tranquilidade, é cegueira.
      datasBase: {},
      contatos: [],
      resumo: "Caso fictício sem a data de citação registrada, para demonstrar a pendência automática do M14.",
      tese: "",
      protocolo: { status:"nao_aplicavel", data:null, recibo:null, verificadoEm:null },
      alertas: [],
      // Prazo que depende de baseChave:"citacao" — mas datasBase.citacao
      // ainda não existe acima. O painel precisa lidar com isso sem
      // quebrar (o prazo simplesmente não aparece na linha do tempo até
      // a data-base ser preenchida; a pendência acima já avisa disso).
      prazos: [ { titulo:"Contestação", tipo:"Contestação", baseChave:"citacao", diasUteis:15, critico:true } ],
      pendencias: [],
      docs: []
    }
  ]
};
