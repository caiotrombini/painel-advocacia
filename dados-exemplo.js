/* ==========================================================================
   ARQUIVO DE EXEMPLO — dados fictícios, seguro para versionar no Git.

   O painel carrega `dados.js`, que NÃO vai para o repositório (veja .gitignore).
   Este arquivo existe para que quem clonar o projeto consiga rodá-lo:
   basta copiar para `dados.js` e substituir pelo conteúdo real.
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

      alertas: [
        { nivel:"alerta", txt:"<strong>Exemplo de alerta.</strong> Aceita HTML simples como negrito." },
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
    }
  ]
};
