/* ==========================================================================
   Painel do Escritório — Caio Trombini Advocacia (OAB/SP 454.679)
   Lógica da aplicação. Os dados ficam em dados.js (window.DADOS).
   ========================================================================== */
"use strict";

/* ---------- Atalhos e constantes ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const MES_ABR = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
const CHAVE = "ctadv_painel_v2";
let DADOS = window.DADOS || { meta:{}, pastas:[], casos:[] };

/* Modo de operação: com File System Access grava em disco; sem ela, só enfileira. */
const MODO_FS = !!(window.isSecureContext && window.showDirectoryPicker);

/* ---------- Estado persistente ---------- */
const estadoPadrao = {
  pend:{}, prazos:{}, tema:"claro", aba:"v-painel",
  compromissos:[], acessos:{}, fila:[], vistoEm:null,
  vencidos:{}, pendPrimeiraVez:{}, ordemRisco:false
};
let estado = Object.assign({}, estadoPadrao);
try { const s = localStorage.getItem(CHAVE); if (s) estado = Object.assign(estado, JSON.parse(s)); } catch (e) {}
function salvar(){ try { localStorage.setItem(CHAVE, JSON.stringify(estado)); } catch(e){ toast("Não foi possível salvar localmente."); } }

/* ---------- Datas ---------- */
function hojeLocal(){ const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function parseData(iso){ const [a,m,d] = iso.split("-").map(Number); return new Date(a, m-1, d); }
function isoDe(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function diasAte(iso){ return Math.round((parseData(iso) - hojeLocal()) / 86400000); }
function fmtData(iso){ const d = parseData(iso); return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`; }
function fmtRelativo(n){
  if (n === 0) return "hoje";
  if (n === 1) return "amanhã";
  if (n === -1) return "ontem";
  if (n < 0) return `há ${Math.abs(n)} dias`;
  if (n <= 45) return `em ${n} dias`;
  const m = Math.round(n / 30.44);
  if (m < 24) return `em ~${m} ${m === 1 ? "mês" : "meses"}`;
  return `em ~${(n/365.25).toFixed(1).replace(".",",")} anos`;
}
function moeda(v){ return v == null ? null : v.toLocaleString("pt-BR",{style:"currency",currency:"BRL",maximumFractionDigits:0}); }
function esc(s){ return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function urlPasta(p){ return "file:///" + p.replace(/ /g,"%20"); }
function semAcento(s){ return String(s).normalize("NFD").replace(/[\u0300-\u036f]/g,""); }

function toast(msg, tipo){
  const t = $("#toast"); if(!t) return;
  t.textContent = msg;
  t.className = "toast ver" + (tipo ? " t-" + tipo : "");
  clearTimeout(t._t); t._t = setTimeout(() => t.className = "toast", 3200);
}

/* ---------- Prazos e compromissos ---------- */
function todosPrazos(){
  const out = [];
  DADOS.casos.forEach(c => (c.prazos||[]).forEach((p,i) => {
    const chave = c.id + "|" + i;
    let item = Object.assign({}, p);
    // M13: se o prazo traz baseChave+diasUteis, calcula de verdade em vez de
    // depender de uma data digitada à mão como "estimado". Sem a data-base
    // ainda registrada, não há como calcular — some da linha do tempo (o
    // M14 já cobra a data-base faltante como pendência/alerta à parte),
    // em vez de quebrar o painel inteiro com uma data inválida.
    if (p.baseChave && p.diasUteis != null){
      const baseData = c.datasBase && c.datasBase[p.baseChave];
      if (!baseData) return;
      const calc = calcularPrazoUteis(baseData, p.diasUteis);
      item.data = calc.data; item.calculado = true; item.baseCalculo = calc.base; item.estimado = false;
    }
    if (!item.data) return;
    out.push(Object.assign(item, {
      caso:c, chave, origem:"caso",
      confirmado: !item.estimado || !!estado.prazos[chave],
      dias: diasAte(item.data),
      resolvido: estado.vencidos[chave] || null
    }));
  }));
  return out.sort((a,b) => a.data < b.data ? -1 : 1);
}
function compromissos(){
  return (estado.compromissos||[]).map((c,i) => {
    const vinc = c.casoId ? DADOS.casos.find(x => x.id === c.casoId) : null;
    return Object.assign({}, c, {
      chave:"esc|"+i, indice:i, origem:"escritorio", confirmado:true, dias:diasAte(c.data),
      vinculado: vinc || null,
      caso: vinc || { cliente: c.pessoa || "Escritório", id:null }
    });
  }).sort((a,b) => (a.data + (a.hora||"")) < (b.data + (b.hora||"")) ? -1 : 1);
}
/* Agendas externas (.ics do Google, do Outlook, ou qualquer outro) */
let agendaExterna = [];
function agendaCompleta(){
  return todosPrazos().concat(compromissos()).concat(agendaExterna)
    .sort((a,b) => (a.data + (a.hora||"00:00")) < (b.data + (b.hora||"00:00")) ? -1 : 1);
}

/* ---------- Leitor de .ics ----------
   Suficiente para o que Google e Outlook exportam: desdobra as linhas,
   entende data pura e data-hora, e ignora recorrência (RRULE) porque
   expandir regra de repetição sem biblioteca gera mais erro do que ajuda. */
function parseICS(txt, origem, rotulo){
  const linhas = txt.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const eventos = [];
  let atual = null;
  const desescapa = s => String(s).replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
  for (const linha of linhas){
    if (linha.startsWith("BEGIN:VEVENT")){ atual = {}; continue; }
    if (linha.startsWith("END:VEVENT")){
      if (atual && atual.data) eventos.push(Object.assign(atual, {
        origem, rotuloFonte: rotulo, confirmado: true, tipo: atual.tipo || "Compromisso",
        caso: { cliente: rotulo, id: null }, chave: origem + "|" + eventos.length,
        dias: diasAte(atual.data)
      }));
      atual = null; continue;
    }
    if (!atual) continue;
    const sep = linha.indexOf(":");
    if (sep < 0) continue;
    const campo = linha.slice(0, sep), valor = linha.slice(sep + 1);
    const nome = campo.split(";")[0].toUpperCase();
    if (nome === "SUMMARY") atual.titulo = desescapa(valor) || "(sem título)";
    else if (nome === "LOCATION") atual.local = desescapa(valor);
    else if (nome === "DESCRIPTION") atual.nota = desescapa(valor).slice(0, 300);
    else if (nome === "RRULE") atual.repete = true;
    else if (nome === "DTSTART"){
      const m = valor.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
      if (m){
        atual.data = `${m[1]}-${m[2]}-${m[3]}`;
        if (m[4]) atual.hora = `${m[4]}:${m[5]}`;
      }
    }
  }
  return eventos.filter(e => !e.repete);   // recorrentes ficam de fora, por segurança
}
function nivelPrazo(p){ if (p.dias < 0) return "venc"; if (p.dias <= 7) return "urg"; if (p.dias <= 30) return "prox"; return "ok"; }

/* ---------- Detecção automática de vínculo com caso ----------
   Pontua o texto do compromisso contra cada caso. Só sugere acima do limiar,
   e a sugestão sempre passa pela confirmação do usuário.                     */
function sugerirCaso(texto){
  const t = semAcento(String(texto||"").toLowerCase());
  if (!t.trim()) return null;
  let melhor = null, melhorPonto = 0;
  DADOS.casos.forEach(c => {
    let pts = 0;
    semAcento(c.cliente.toLowerCase()).split(/\s+/).filter(w => w.length >= 4)
      .forEach(w => { if (t.includes(w)) pts += 5; });
    (c.contatos||[]).forEach(k => {
      semAcento(k.nome.toLowerCase()).split(/[\s(—-]+/).filter(w => w.length >= 4)
        .forEach(w => { if (t.includes(w)) pts += 3; });
    });
    semAcento(String(c.parteContraria||"").toLowerCase()).split(/\s+/).filter(w => w.length >= 5)
      .forEach(w => { if (t.includes(w)) pts += 2; });
    const area = semAcento(String(c.area||"").toLowerCase());
    if (/trabalh/.test(area) && /(trabalhista|clt|rescis|fgts|vara do trabalho|verbas)/.test(t)) pts += 2;
    if (/(civel|estado|fazenda)/.test(area) && /(fazenda|municip|prefeitur|erro medico|sus)/.test(t)) pts += 2;
    if (c.numeroProcesso && t.includes(semAcento(String(c.numeroProcesso).toLowerCase().slice(0,10)))) pts += 8;
    if (pts > melhorPonto){ melhorPonto = pts; melhor = c; }
  });
  return melhorPonto >= 3 ? { caso:melhor, pontos:melhorPonto, forte:melhorPonto >= 5 } : null;
}

/* Varre a agenda e propõe vínculos para compromissos ainda soltos. */
function reclassificarAgenda(){
  const propostas = [];
  (estado.compromissos||[]).forEach((c,i) => {
    if (c.casoId || c.semVinculo) return;
    const s = sugerirCaso([c.titulo, c.pessoa, c.nota, c.local].filter(Boolean).join(" "));
    if (s) propostas.push({ indice:i, comp:c, sug:s });
  });
  if (!propostas.length){
    const soltos = (estado.compromissos||[]).filter(c => !c.casoId).length;
    toast(soltos ? `Nada novo a vincular. ${soltos} compromisso(s) seguem como movimentação do escritório.`
                 : "Agenda toda classificada.", "ok");
    return;
  }
  $("#rc-lista").innerHTML = propostas.map(p => `
    <li>
      <label>
        <input type="checkbox" data-rc="${p.indice}" ${p.sug.forte ? "checked" : ""}>
        <span>
          <strong>${esc(p.comp.titulo)}</strong> <span class="dim">${fmtData(p.comp.data)}</span><br>
          <span class="dim">vincular ao caso</span> <strong>${esc(p.sug.caso.cliente)}</strong>
          <span class="selo selo-${p.sug.forte ? "ok" : "alerta"} mini">${p.sug.forte ? "correspondência forte" : "possível — confira"}</span>
        </span>
      </label>
    </li>`).join("");
  $("#dlg-reclass").showModal();
}
function aplicarReclassificacao(){
  let n = 0;
  $$("[data-rc]").forEach(ch => {
    const i = +ch.dataset.rc;
    if (ch.checked){
      const s = sugerirCaso([estado.compromissos[i].titulo, estado.compromissos[i].pessoa, estado.compromissos[i].nota].filter(Boolean).join(" "));
      if (s){ estado.compromissos[i].casoId = s.caso.id; estado.compromissos[i].semVinculo = false; n++; }
    } else {
      estado.compromissos[i].semVinculo = true;   // não perguntar de novo
    }
  });
  salvar(); $("#dlg-reclass").close(); renderTudo();
  toast(n ? `${n} compromisso(s) vinculado(s) a casos.` : "Nenhum vínculo aplicado.", "ok");
}

/* ==========================================================================
   Acesso ao disco (File System Access API)
   ========================================================================== */
let raizHandle = null;
const DB = { nome:"ctadv", store:"handles" };
function idb(){
  return new Promise((ok,err) => {
    const r = indexedDB.open(DB.nome, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(DB.store);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => err(r.error);
  });
}
async function guardarHandle(h){
  try { const db = await idb(); db.transaction(DB.store,"readwrite").objectStore(DB.store).put(h,"raiz"); } catch(e){}
}
async function lerHandle(){
  try {
    const db = await idb();
    return await new Promise(ok => {
      const req = db.transaction(DB.store,"readonly").objectStore(DB.store).get("raiz");
      req.onsuccess = () => ok(req.result || null);
      req.onerror = () => ok(null);
    });
  } catch(e){ return null; }
}
async function temPermissao(h, escrita){
  if (!h) return false;
  const opt = { mode: escrita ? "readwrite" : "read" };
  if (await h.queryPermission(opt) === "granted") return true;
  return await h.requestPermission(opt) === "granted";
}
async function conectarPasta(){
  if (!MODO_FS){ toast("Só disponível com o painel servido por https ou localhost.","alerta"); return; }
  try {
    raizHandle = await window.showDirectoryPicker({ mode:"readwrite", startIn:"documents" });
    await guardarHandle(raizHandle);
    await resolverBase();
    const n = await carregarDadosDaPasta();
    await carregarAgendasDaPasta();
    if (n >= 0) toast(n ? `Pasta conectada — ${n} caso(s) carregado(s) do seu computador.` : "Pasta conectada: " + raizHandle.name, "ok");
    renderTudo();
  } catch(e){ if (e.name !== "AbortError") toast("Não foi possível conectar: " + e.message, "erro"); }
}
async function restaurarPasta(){
  if (!MODO_FS) return;
  const h = await lerHandle();
  if (h && await temPermissao(h, true)) {
    raizHandle = h;
    await resolverBase();
    await carregarDadosDaPasta();
    await carregarAgendasDaPasta();
    renderTudo();
  }
}

/* ---------- Carregar dados.js de dentro da pasta conectada ----------
   É isto que faz a versão publicada funcionar: o programa vem da internet,
   os dados vêm do disco (Google Drive sincronizado). Nada de cliente
   trafega pela rede.                                                     */
const CAMINHOS_DADOS = [
  ["dados.js"],
  ["02_CONTROLE","painel","dados.js"],
  ["painel","dados.js"],
  ["02_CONTROLE","dados.js"]
];
async function carregarDadosDaPasta(){
  if (!raizHandle) return 0;
  for (const caminho of CAMINHOS_DADOS){
    try {
      let dir = baseHandle || raizHandle;
      for (const parte of caminho.slice(0,-1)) dir = await dir.getDirectoryHandle(parte);
      const fh = await dir.getFileHandle(caminho[caminho.length-1]);
      const txt = await (await fh.getFile()).text();
      const alvo = {};
      new Function("window", txt)(alvo);          // executa isolado; não toca no window real
      if (alvo.DADOS && Array.isArray(alvo.DADOS.casos)){
        const r = aplicarDadosValidados(alvo.DADOS);   // M08: não troca DADOS se o schema não bater
        if (!r.ok){
          toast(`dados.js tem ${r.erros.length} problema(s) de schema — painel manteve os dados anteriores.`, "erro");
          return -1;
        }
        estado.origemDados = caminho.join("/");
        salvar();
        return DADOS.casos.length;
      }
    } catch(e){ /* tenta o próximo caminho */ }
  }
  return 0;
}

/* ---------- Agendas externas vindas da pasta ----------
   Qualquer .ics em 02_CONTROLE/painel/agendas/ entra no calendário.
   O nome do arquivo define a cor: google*.ics, outlook*.ics, o resto vira "externa". */
const PASTAS_AGENDA = [
  ["agendas"],
  ["02_CONTROLE","painel","agendas"],
  ["painel","agendas"],
  ["02_CONTROLE","agendas"]
];
let fontesAgenda = [];
async function carregarAgendasDaPasta(){
  agendaExterna = []; fontesAgenda = [];
  if (!raizHandle) return 0;
  let dir = null;
  for (const caminho of PASTAS_AGENDA){
    try {
      let d = baseHandle || raizHandle;
      for (const parte of caminho) d = await d.getDirectoryHandle(parte);
      dir = d; break;
    } catch(e){ /* tenta a próxima */ }
  }
  if (!dir) return 0;
  for await (const [nome, h] of dir.entries()){
    if (h.kind !== "file" || !/\.ics$/i.test(nome)) continue;
    try {
      const f = await h.getFile();
      const n = semAcento(nome.toLowerCase());
      const origem = /google|gmail/.test(n) ? "google" : /outlook|hotmail|live/.test(n) ? "outlook" : "externa";
      const rotulo = origem === "google" ? "Google Agenda" : origem === "outlook" ? "Outlook" : nome.replace(/\.ics$/i, "");
      const evs = parseICS(await f.text(), origem, rotulo);
      agendaExterna = agendaExterna.concat(evs);
      fontesAgenda.push({ nome, rotulo, origem, total: evs.length, mod: f.lastModified });
    } catch(e){ fontesAgenda.push({ nome, rotulo:nome, origem:"externa", total:0, erro:e.message }); }
  }
  return agendaExterna.length;
}

/* ---------- Botão "Carregar do Drive": faz a varredura completa ---------- */
async function carregarTudoDoDrive(){
  const btn = $("#btn-carregar-drive");
  if (btn) btn.disabled = true;
  try {
    if (!MODO_FS){
      toast("Este modo não permite ler a pasta. Abra o painel pelo endereço publicado.", "alerta");
      return;
    }
    if (!raizHandle){
      raizHandle = await window.showDirectoryPicker({ mode:"readwrite", startIn:"documents" });
      await guardarHandle(raizHandle);
    } else if (!await temPermissao(raizHandle, true)){
      toast("Permissão de acesso à pasta negada.", "erro"); return;
    }
    await resolverBase();
    const nCasos = await carregarDadosDaPasta();
    const nEventos = await carregarAgendasDaPasta();
    const nPastas = await contarPastasDeCaso();
    renderTudo();
    if (nCasos >= 0){
      const partes = [];
      partes.push(nCasos ? `${nCasos} caso(s)` : `nenhum caso encontrado a partir de "${(baseHandle||raizHandle).name}" — selecione a pasta ADVOCACIA`);
      if (nEventos) partes.push(`${nEventos} evento(s) de ${fontesAgenda.length} agenda(s)`);
      if (nPastas) partes.push(`${nPastas} pasta(s) de cliente`);
      toast("Carregado do Drive: " + partes.join(" · "), nCasos ? "ok" : "alerta");
    }
  } catch(e){
    if (e.name !== "AbortError") toast("Falha ao carregar: " + e.message, "erro");
  } finally { if (btn) btn.disabled = false; }
}
async function contarPastasDeCaso(){
  try {
    let d = baseHandle || raizHandle;
    try { d = await d.getDirectoryHandle("01_CLIENTES"); } catch(e){ /* a base pode já ser 01_CLIENTES */ }
    let n = 0;
    for await (const [nome, h] of d.entries()) if (h.kind === "directory" && !nome.startsWith("_")) n++;
    return n;
  } catch(e){ return 0; }
}
/* ---------- Localizar a pasta ADVOCACIA ----------
   O usuário pode selecionar a raiz do G:, o "Meu Drive", a própria ADVOCACIA
   ou até a pasta do painel. Em vez de exigir acerto, o painel procura. */
let baseHandle = null;
async function ehPastaEscritorio(dir){
  for (const alvo of ["02_CONTROLE","01_CLIENTES"]){
    try { await dir.getDirectoryHandle(alvo); return true; } catch(e){}
  }
  return false;
}
async function procurarEscritorio(dir, profundidade){
  if (await ehPastaEscritorio(dir)) return dir;
  if (profundidade <= 0) return null;
  const subs = [];
  try {
    for await (const [nome, h] of dir.entries()){
      if (h.kind !== "directory") continue;
      if (nome.startsWith("$") || nome.startsWith(".") || nome === "System Volume Information") continue;
      if (nome.toUpperCase() === "ADVOCACIA") return h;      // atalho: achou pelo nome
      subs.push(h);
      if (subs.length > 40) break;                           // não varre disco inteiro
    }
  } catch(e){ return null; }
  for (const h of subs){
    const r = await procurarEscritorio(h, profundidade - 1);
    if (r) return r;
  }
  return null;
}
async function resolverBase(){
  if (!raizHandle) { baseHandle = null; return null; }
  baseHandle = await procurarEscritorio(raizHandle, 3) || raizHandle;
  return baseHandle;
}

async function navegar(caminho){            // caminho relativo à pasta do escritório
  let dir = baseHandle || raizHandle;
  for (const parte of caminho) dir = await dir.getDirectoryHandle(parte, { create:true });
  return dir;
}
async function listarPasta(caminho){
  const dir = await navegar(caminho);
  const itens = [];
  for await (const [nome, h] of dir.entries()){
    if (nome.startsWith("_") || nome === "desktop.ini") continue;
    let tam = null, mod = null;
    if (h.kind === "file"){ try { const f = await h.getFile(); tam = f.size; mod = f.lastModified; } catch(e){} }
    itens.push({ nome, tipo:h.kind, tam, mod, handle:h });
  }
  return itens.sort((a,b) => a.tipo !== b.tipo ? (a.tipo === "directory" ? -1 : 1) : a.nome.localeCompare(b.nome,"pt-BR"));
}
function fmtTam(b){
  if (b == null) return "";
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b/1024).toFixed(0) + " KB";
  return (b/1048576).toFixed(1) + " MB";
}

/* ==========================================================================
   Classificação automática de documentos
   ========================================================================== */
const REGRAS = [
  { re:/procura|proc[\s_-]|ad[\s_-]?judicia/i,              sub:"01_Documentos do Cliente",     tipo:"Procuracao" },
  { re:/hipo|hipossufici|gratuidade|justi[çc]a gratuita/i,  sub:"01_Documentos do Cliente",     tipo:"Declaracao de Hipossuficiencia" },
  { re:/resid[êe]ncia|comprovante de end/i,                 sub:"01_Documentos do Cliente",     tipo:"Declaracao de Residencia" },
  { re:/\brg\b|identidade|\bcpf\b|cnh|documento pessoal/i,  sub:"01_Documentos do Cliente",     tipo:"Documento de Identificacao" },
  { re:/prontu|laudo|exame|receita|atestado|m[ée]dic|ultrass|raio|rx\b|usg/i, sub:"01_Documentos do Cliente", tipo:"Documento Medico" },
  { re:/ctps|carteira de trabalho|contracheque|holerite|fgts|rescis/i, sub:"01_Documentos do Cliente", tipo:"Documento Trabalhista" },
  { re:/foto|imagem|\.jpe?g$|\.png$|\.heic$/i,              sub:"01_Documentos do Cliente",     tipo:"Foto" },
  { re:/v[íi]deo|\.mp4$|\.mov$|\.avi$/i,                    sub:"01_Documentos do Cliente",     tipo:"Video" },
  { re:/inicial|peti[çc]|contesta|r[ée]plica|manifesta|recurso|apela|agravo|embargos|contrarraz/i, sub:"02_Peticoes e Manifestacoes", tipo:"Peticao" },
  { re:/guia|dare|fedtj|\bgrd\b|custas|preparo|taxa judici/i, sub:"03_Guias e Comprovantes",    tipo:"Guia" },
  { re:/comprovante|recibo|protocolo|pagamento|quita/i,     sub:"03_Guias e Comprovantes",      tipo:"Comprovante" },
  { re:/estrat[ée]gia|memorando|anota|resumo|c[áa]lculo|planilha|minuta interna/i, sub:"04_Estrategia e Anotacoes Internas", tipo:"Documento Interno" },
  { re:/whatsapp|conversa|e-?mail|mensagem|carta ao cliente/i, sub:"05_Correspondencia com Cliente", tipo:"Correspondencia" },
  { re:/despacho|senten[çc]a|decis[ãa]o|ac[óo]rd[ãa]o|certid|intima/i, sub:"02_Peticoes e Manifestacoes", tipo:"Ato Judicial" },
  { re:/contrato|honor[áa]rio/i,                            sub:"01_Documentos do Cliente",     tipo:"Contrato de Honorarios" }
];
function classificar(nomeArquivo){
  for (const r of REGRAS) if (r.re.test(nomeArquivo)) return { sub:r.sub, tipo:r.tipo, certeza:"alta" };
  return { sub:"01_Documentos do Cliente", tipo:"Documento", certeza:"baixa" };
}
function nomePadrao(arquivo, caso, cls){
  const ext = (arquivo.name.match(/\.[^.]+$/) || [""])[0].toLowerCase();
  const data = arquivo.lastModified ? isoDe(new Date(arquivo.lastModified)) : isoDe(hojeLocal());
  const cli = semAcento(caso.cliente).replace(/[^\w\s-]/g,"").trim().split(/\s+/).slice(0,2).join(" ");
  return `${data} - ${cls.tipo} - ${cli}${ext}`;
}
async function arquivarNoDisco(arquivo, caso, cls, nomeFinal){
  const partes = caso.pasta.split("/");
  const idx = partes.indexOf("01_CLIENTES");
  const relativo = idx >= 0 ? partes.slice(idx) : ["01_CLIENTES", partes[partes.length-1]];
  const dir = await navegar(relativo.concat([cls.sub]));
  let nome = nomeFinal, tentativa = 1;
  while (true) {                                  // nunca sobrescreve arquivo existente
    let existe = false;
    try { await dir.getFileHandle(nome); existe = true; } catch(e){ existe = false; }
    if (!existe) break;
    const m = nomeFinal.match(/^(.*?)(\.[^.]+)?$/);
    nome = `${m[1]} (${++tentativa})${m[2]||""}`;
  }
  const fh = await dir.getFileHandle(nome, { create:true });
  const w = await fh.createWritable();
  await w.write(await arquivo.arrayBuffer());
  await w.close();
  return { nome, caminho: relativo.concat([cls.sub, nome]).join("/") };
}
async function receberArquivos(lista, casoId){
  const caso = DADOS.casos.find(c => c.id === casoId);
  if (!caso){ toast("Caso não identificado.","erro"); return; }
  let ok = 0, err = 0;
  for (const arquivo of lista){
    const cls = classificar(arquivo.name);
    const nome = nomePadrao(arquivo, caso, cls);
    if (MODO_FS && raizHandle){
      try {
        const r = await arquivarNoDisco(arquivo, caso, cls, nome); ok++;
        registrarFila({ arquivo:arquivo.name, caso:caso.cliente, destino:r.caminho, nomeFinal:r.nome, estado:"arquivado", quando:Date.now(), certeza:cls.certeza });
      } catch(e){ err++; toast("Falha ao gravar " + arquivo.name + ": " + e.message, "erro"); }
    } else {
      registrarFila({ arquivo:arquivo.name, caso:caso.cliente, destino:`${caso.pasta}/${cls.sub}`, nomeFinal:nome, estado:"pendente", quando:Date.now(), certeza:cls.certeza });
      ok++;
    }
  }
  salvar(); renderTudo();
  if (MODO_FS && raizHandle) toast(`${ok} arquivo(s) gravado(s) na pasta do caso.${err?` ${err} falhou.`:""}`, err?"alerta":"ok");
  else toast(`${ok} arquivo(s) na fila de arquivamento — veja a aba Arquivos.`, "ok");
}
function registrarFila(item){
  estado.fila = estado.fila || [];
  estado.fila.unshift(item);
  if (estado.fila.length > 200) estado.fila.length = 200;
}

/* ==========================================================================
   Navegação somente leitura (nunca cria pasta) — usada pelas auditorias.
   ========================================================================== */
async function navegarSoLeitura(caminho){
  let dir = baseHandle || raizHandle;
  for (const parte of caminho) dir = await dir.getDirectoryHandle(parte); // sem {create:true}
  return dir;
}
async function listarArquivosRecursivo(dir, profundidade){
  const out = [];
  if (profundidade <= 0) return out;
  for await (const [nome, h] of dir.entries()){
    if (nome.startsWith("_") || nome === "desktop.ini" || nome === "Thumbs.db") continue;
    if (h.kind === "file") out.push(nome);
    else out.push(...await listarArquivosRecursivo(h, profundidade-1));
  }
  return out;
}
function nomePastaDeCaso(c){
  const partes = String(c.pasta||"").split(/[\\/]/).filter(Boolean);
  return partes[partes.length-1] || null;
}

/* ==========================================================================
   M12 + M17 — divergências entre dados.js e o disco. Só relata, nunca
   cria, move ou apaga nada.
   ========================================================================== */
async function auditarDivergencias(){
  if (!MODO_FS || !raizHandle){ toast("Conecte a pasta primeiro (Carregar do Drive).","alerta"); return; }
  const box = $("#divergencias");
  box.classList.remove("oculto");
  box.innerHTML = "Auditando…";
  try {
    let dirClientes;
    try { dirClientes = await navegarSoLeitura(["01_CLIENTES"]); }
    catch(e){
      box.innerHTML = `<div class="vazio-msg">Não encontrei a pasta "01_CLIENTES" dentro de "${esc((baseHandle||raizHandle).name)}". Conecte a pasta raiz do escritório (ADVOCACIA) e tente de novo.</div>`;
      return;
    }

    // M17: pastas reais x casos[].pasta, nos dois sentidos
    const pastasReais = [];
    for await (const [nome, h] of dirClientes.entries()) if (h.kind === "directory" && !nome.startsWith("_")) pastasReais.push(nome);
    const pastasEsperadas = new Set(DADOS.casos.map(nomePastaDeCaso).filter(Boolean));
    const pastasOrfas = pastasReais.filter(n => !pastasEsperadas.has(n));
    const casosSemPasta = DADOS.casos.filter(c => { const n = nomePastaDeCaso(c); return n && !pastasReais.includes(n); });

    // M12: docs[] declarados x arquivos reais, por caso (só quando a pasta existe)
    const docsFaltando = [], arquivosNaoListados = [];
    for (const c of DADOS.casos){
      const nomePasta = nomePastaDeCaso(c);
      if (!nomePasta || !pastasReais.includes(nomePasta)) continue;
      let arquivosReais;
      try { arquivosReais = await listarArquivosRecursivo(await dirClientes.getDirectoryHandle(nomePasta), 3); }
      catch(e){ continue; }
      const normReais = arquivosReais.map(n => semAcento(n.toLowerCase()));
      (c.docs||[]).forEach(d => {
        if (!/\.[a-z0-9]{2,4}$/i.test(d)) return; // só cobra entradas que parecem nome de arquivo de verdade
        const alvo = semAcento(d.toLowerCase());
        if (!normReais.some(n => n.includes(alvo) || alvo.includes(n)))
          docsFaltando.push({ caso:c.cliente, doc:d });
      });
      arquivosReais.forEach(nome => {
        const norm = semAcento(nome.toLowerCase());
        const mencionado = (c.docs||[]).some(d => { const alvo = semAcento(d.toLowerCase()); return alvo.includes(norm) || norm.includes(alvo); });
        if (!mencionado) arquivosNaoListados.push({ caso:c.cliente, arquivo:nome });
      });
    }

    const grupo = (titulo, itens, fmt) => itens.length ? `<div class="divergencia-grupo"><h4>${esc(titulo)} (${itens.length})</h4><ul>${itens.map(fmt).join("")}</ul></div>` : "";
    box.innerHTML = [
      grupo("Pastas em 01_CLIENTES sem caso correspondente em dados.js", pastasOrfas, n => `<li>${esc(n)}</li>`),
      grupo("Casos em dados.js cuja pasta não existe no disco", casosSemPasta, c => `<li>${esc(c.cliente)} — esperada "${esc(nomePastaDeCaso(c))}"</li>`),
      grupo("Documentos listados em docs[] não localizados no disco", docsFaltando, d => `<li>${esc(d.caso)} — "${esc(d.doc)}"</li>`),
      grupo("Arquivos no disco não mencionados em docs[]", arquivosNaoListados, a => `<li>${esc(a.caso)} — ${esc(a.arquivo)}</li>`)
    ].join("") || '<div class="vazio-msg">Nenhuma divergência encontrada.</div>';
  } catch(e){ box.innerHTML = `<div class="vazio-msg">Falha ao auditar: ${esc(e.message)}</div>`; }
}

/* ==========================================================================
   M18 — novo caso no momento zero. Cria a pasta padrão de verdade; o
   esqueleto do caso é só copiado/baixado — dados.js continua edição manual.
   ========================================================================== */
const SUBPASTAS_CASO = ["01_Documentos do Cliente","02_Peticoes e Manifestacoes","03_Guias e Comprovantes","04_Estrategia e Anotacoes Internas","05_Correspondencia com Cliente"];
function slugId(txt){ return semAcento(txt).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,""); }
function clienteParecido(nome){
  const alvo = semAcento(nome.toLowerCase()).trim();
  return DADOS.casos.filter(c => {
    const existente = semAcento(c.cliente.toLowerCase()).trim();
    return existente === alvo || existente.includes(alvo) || alvo.includes(existente);
  });
}
async function criarNovoCaso(cliente, area, confirmarDuplicata){
  if (!MODO_FS || !raizHandle){ toast("Conecte a pasta primeiro.","alerta"); return; }
  const parecidos = clienteParecido(cliente);
  if (parecidos.length && !confirmarDuplicata){
    $("#nc-aviso").classList.remove("oculto");
    $("#nc-aviso").innerHTML = `Já existe caso parecido: <strong>${parecidos.map(c=>esc(c.cliente)).join(", ")}</strong>. Clique em "Criar pasta e gerar esqueleto" de novo para criar mesmo assim.`;
    $("#form-novo-caso").dataset.confirmar = "1";
    return;
  }
  const nomePasta = `${cliente} - ${area}`.replace(/[\\/:*?"<>|]/g,"");
  let id = slugId(cliente), tentativa = 1;
  while (DADOS.casos.some(c => c.id === id)) id = slugId(cliente) + "-" + (++tentativa);
  try {
    const dirClientes = await navegar(["01_CLIENTES"]);
    const dirCaso = await dirClientes.getDirectoryHandle(nomePasta, { create:true });
    for (const sub of SUBPASTAS_CASO) await dirCaso.getDirectoryHandle(sub, { create:true });
    const caminhoBase = (baseHandle||raizHandle).name + "/01_CLIENTES/" + nomePasta;
    const esqueleto = {
      id, cliente, clienteObs:null, titulo:`${area} — a definir`, area,
      parteContraria:null, numeroProcesso:null, foro:null,
      fase:"Atendimento inicial", status:"Em atendimento inicial", statusTipo:"info",
      valorCausa:null, responsavel:null,
      pasta:`${caminhoBase}  /* CONFIRA o caminho completo real — o navegador não revela o disco inteiro */`,
      datasBase:{}, contatos:[], resumo:"", tese:"",
      alertas:[], prazos:[], pendencias:[], docs:[],
      protocolo:{ status:"nao_aplicavel", data:null, recibo:null, verificadoEm:null }
    };
    const texto = "    " + JSON.stringify(esqueleto, null, 2).split("\n").join("\n    ") + ",";
    copiar(texto, `Pasta "${nomePasta}" criada. Esqueleto do caso (id: ${id}) copiado — cole dentro de casos[] em dados.js.`);
    $("#dlg-novo-caso").close();
    $("#nc-aviso").classList.add("oculto");
    delete $("#form-novo-caso").dataset.confirmar;
    $("#nc-cliente").value = ""; $("#nc-area").value = "";
  } catch(e){ toast("Falha ao criar a pasta: " + e.message, "erro"); }
}

/* ==========================================================================
   M20 — resumo diário (HOJE.md). Só o que cabe numa tela: vencidos sem
   desfecho, prazos de 7 dias, protocolos não confirmados, casos parados.
   ========================================================================== */
function gerarResumoDiaMD(){
  const hoje = hojeLocal();
  const vencidos = prazosVencidosSemDesfecho();
  const seteDias = todosPrazos().filter(p => p.dias >= 0 && p.dias <= 7);
  const semConfirmar = protocolosSemConfirmar();
  const parados = DADOS.casos.filter(c => scoreRisco(c).criterios.includes("pendência alta parada há mais de 14 dias"));
  const linha = (arr, fmt, vazio) => arr.length ? arr.slice(0,10).map(fmt).join("\n") + (arr.length>10?`\n- …e mais ${arr.length-10}`:"") : `- ${vazio}`;
  return `# Resumo do dia — ${fmtData(isoDe(hoje))}

## Prazos vencidos sem desfecho (${vencidos.length})
${linha(vencidos, p => `- **${esc(p.caso.cliente)}** — ${esc(p.titulo)} (venceu ${fmtData(p.data)})`, "nenhum")}

## Prazos nos próximos 7 dias (${seteDias.length})
${linha(seteDias, p => `- ${esc(p.caso.cliente)} — ${esc(p.titulo)} — ${fmtData(p.data)} (${fmtRelativo(p.dias)})`, "nenhum")}

## Protocolos não confirmados (${semConfirmar.length})
${linha(semConfirmar, c => `- **${esc(c.cliente)}** — tentado em ${fmtData(c.protocolo.data)}`, "nenhum")}

## Casos parados há mais de 14 dias (${parados.length})
${linha(parados, c => `- ${esc(c.cliente)}`, "nenhum")}
`;
}
async function gerarResumoDia(){
  const md = gerarResumoDiaMD();
  if (MODO_FS && raizHandle){
    try {
      const dirControle = await navegar(["02_CONTROLE"]);
      const fh = await dirControle.getFileHandle("HOJE.md", { create:true });
      const w = await fh.createWritable(); await w.write(md); await w.close();
      toast("02_CONTROLE/HOJE.md atualizado.","ok");
      return;
    } catch(e){ toast("Não deu para gravar em 02_CONTROLE — baixando em vez disso.","alerta"); }
  }
  baixarBlob(md, "text/markdown;charset=utf-8", "HOJE.md");
  toast("HOJE.md baixado — pasta não está conectada.","ok");
}

/* ==========================================================================
   Validação de schema (M08) — roda antes de qualquer render.
   Uma vírgula sobrando em dados.js não pode derrubar o painel em branco:
   se o schema não bate, mantém o DADOS anterior (ou vazio) e mostra
   exatamente qual caso/campo está errado.
   ========================================================================== */
const ENUM_STATUS_TIPO = ["ok","alerta","perigo","info","neutro"];
const ENUM_NIVEL_ALERTA = ["perigo","alerta","info"];
const ENUM_PRIORIDADE = ["alta","media","baixa"];
const ENUM_PROTOCOLO_STATUS = ["nao_aplicavel","pendente","tentado_sem_confirmacao","confirmado"];

function dataISOValida(s){
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [a,m,d] = s.split("-").map(Number);
  const dt = new Date(a,m-1,d);
  return dt.getFullYear()===a && dt.getMonth()===m-1 && dt.getDate()===d;
}

function validarDados(dados){
  const erros = [];
  const add = (casoId, campo, msg) => erros.push({ casoId, campo, msg });

  if (!dados || typeof dados !== "object"){ add(null,"raiz","window.DADOS não é um objeto."); return erros; }
  if (!Array.isArray(dados.casos)){ add(null,"casos","DADOS.casos não é uma lista."); return erros; }

  const idsVistos = new Set();
  dados.casos.forEach((c, idx) => {
    const rotulo = c && c.id ? c.id : `casos[${idx}]`;
    if (!c || typeof c !== "object"){ add(rotulo,"raiz","item de casos[] não é um objeto."); return; }

    ["id","cliente","titulo","area","fase","status","statusTipo","pasta"].forEach(campo => {
      if (c[campo] == null || c[campo] === ""){ add(rotulo, campo, `campo obrigatório "${campo}" ausente ou vazio.`); }
    });

    if (c.id != null){
      if (idsVistos.has(c.id)) add(rotulo,"id",`id duplicado: "${c.id}" já usado por outro caso.`);
      idsVistos.add(c.id);
    }

    if (c.statusTipo != null && !ENUM_STATUS_TIPO.includes(c.statusTipo))
      add(rotulo,"statusTipo",`valor "${c.statusTipo}" fora do enum (${ENUM_STATUS_TIPO.join(", ")}).`);

    if (c.datasBase && typeof c.datasBase === "object")
      Object.entries(c.datasBase).forEach(([chave,val]) => {
        if (!dataISOValida(val)) add(rotulo,`datasBase.${chave}`,`data "${val}" inválida — esperado AAAA-MM-DD.`);
      });

    (c.alertas||[]).forEach((a,i) => {
      if (!a || !ENUM_NIVEL_ALERTA.includes(a.nivel))
        add(rotulo,`alertas[${i}].nivel`,`valor "${a&&a.nivel}" fora do enum (${ENUM_NIVEL_ALERTA.join(", ")}).`);
    });

    (c.prazos||[]).forEach((p,i) => {
      // M13: um prazo é ou uma data fixa (AAAA-MM-DD), ou baseChave+diasUteis
      // para o painel calcular sozinho — precisa de exatamente uma das duas formas.
      const temDataFixa = p && p.data != null;
      const temBaseCalculo = p && p.baseChave != null && p.diasUteis != null;
      if (!p || (!temDataFixa && !temBaseCalculo))
        add(rotulo,`prazos[${i}]`,"prazo sem data e sem baseChave+diasUteis para calcular.");
      else if (temDataFixa && !dataISOValida(p.data))
        add(rotulo,`prazos[${i}].data`,`data "${p.data}" inválida — esperado AAAA-MM-DD.`);
      if (!p || !p.titulo) add(rotulo,`prazos[${i}].titulo`,"prazo sem título.");
    });

    (c.pendencias||[]).forEach((p,i) => {
      if (!p || !ENUM_PRIORIDADE.includes(p.p))
        add(rotulo,`pendencias[${i}].p`,`valor "${p&&p.p}" fora do enum (${ENUM_PRIORIDADE.join(", ")}).`);
    });

    if (c.protocolo != null){
      if (!ENUM_PROTOCOLO_STATUS.includes(c.protocolo.status))
        add(rotulo,"protocolo.status",`valor "${c.protocolo.status}" fora do enum (${ENUM_PROTOCOLO_STATUS.join(", ")}).`);
      if (c.protocolo.data != null && !dataISOValida(c.protocolo.data))
        add(rotulo,"protocolo.data",`data "${c.protocolo.data}" inválida — esperado AAAA-MM-DD.`);
    }
  });

  return erros;
}

function mostrarErrosSchema(erros){
  const box = $("#erros-schema");
  if (!box) return;
  if (!erros.length){ box.classList.add("oculto"); box.innerHTML = ""; return; }
  box.classList.remove("oculto");
  box.innerHTML = `<strong>${erros.length} problema(s) no schema de dados.js — corrija antes de confiar no painel:</strong>
    <ul>${erros.slice(0,30).map(e => `<li><code>${esc(String(e.casoId))}</code> · <code>${esc(e.campo)}</code> — ${esc(e.msg)}</li>`).join("")}</ul>
    ${erros.length>30 ? `<p>...e mais ${erros.length-30}.</p>` : ""}`;
}

/* Aplica um DADOS recém-carregado só se passar na validação; senão preserva
   o que já estava carregado e devolve os erros para quem chamou decidir o toast. */
function aplicarDadosValidados(candidato){
  const erros = validarDados(candidato);
  if (erros.length){ mostrarErrosSchema(erros); return { ok:false, erros }; }
  DADOS = candidato;
  mostrarErrosSchema([]);
  return { ok:true, erros:[] };
}

/* ==========================================================================
   Validação de número CNJ (M11) — Resolução CNJ 65/2008.
   Formato NNNNNNN-DD.AAAA.J.TR.OOOO; DD é dígito verificador módulo 97.
   ========================================================================== */
function validarCNJ(numero){
  if (typeof numero !== "string") return { valido:false, motivo:"não é texto" };
  const m = numero.match(/^(\d{7})-?(\d{2})\.?(\d{4})\.?(\d{1})\.?(\d{2})\.?(\d{4})$/);
  if (!m) return { valido:false, motivo:"formato diferente de NNNNNNN-DD.AAAA.J.TR.OOOO" };
  const [, seq, dv, ano, justica, tribunal, origem] = m;
  const resto1 = Number(seq + ano + justica) % 97;
  const resto2 = Number(String(resto1).padStart(2,"0") + tribunal + origem) % 97;
  const dvCalculado = String(98 - resto2).padStart(2,"0");
  if (dvCalculado !== dv) return { valido:false, motivo:`dígito verificador incorreto — esperado ${dvCalculado}, encontrado ${dv}` };
  return { valido:true };
}

/* ==========================================================================
   Data-base faltante para calcular prazo (M14) — se a fase já exige um
   marco que não foi registrado, isso é cegueira, não tranquilidade.
   ========================================================================== */
const REQUISITOS_DATABASE = [
  { faseRe:/contesta/i,                    chave:"citacao",              prazoNome:"contestação" },
  { faseRe:/r[ée]plica/i,                  chave:"intimacaoContestacao", prazoNome:"réplica" },
  { faseRe:/recurso|apela[çc][ãa]o|agravo/i, chave:"publicacaoDecisao",  prazoNome:"recurso" },
  { faseRe:/embargos de declara/i,         chave:"publicacaoDecisao",    prazoNome:"embargos de declaração" },
  { faseRe:/cumprimento de senten/i,       chave:"transitoJulgado",      prazoNome:"cumprimento de sentença" }
];
function pendenciasDataBaseFaltante(caso){
  const out = [];
  REQUISITOS_DATABASE.forEach(r => {
    if (r.faseRe.test(caso.fase||"") && !(caso.datasBase && caso.datasBase[r.chave]))
      out.push(`Obter a data de "${r.chave}" (necessária para calcular o prazo de ${r.prazoNome}).`);
  });
  return out;
}

/* ==========================================================================
   Calculadora de prazo (M13) — dias úteis, art. 224 do CPC, feriados e
   recesso forense. Resultado sempre rotulado como ESTIMADO com a base de
   cálculo explícita: isto não substitui conferência humana.
   ========================================================================== */
function pascoa(ano){
  const a = ano % 19, b = Math.floor(ano/100), c = ano % 100;
  const d = Math.floor(b/4), e = b % 4, f = Math.floor((b+8)/25);
  const g = Math.floor((b-f+1)/3), h = (19*a+b-d-g+15) % 30;
  const i = Math.floor(c/4), k = c % 4, l = (32+2*e+2*i-h-k) % 7;
  const mm = Math.floor((a+11*h+22*l)/451);
  const mes = Math.floor((h+l-7*mm+114)/31), dia = ((h+l-7*mm+114) % 31) + 1;
  return new Date(ano, mes-1, dia);
}
function addDias(d, n){ const r = new Date(d); r.setDate(r.getDate()+n); return r; }
function feriadosNacionaisEEstaduaisSP(ano){
  const p = pascoa(ano);
  return [
    new Date(ano,0,1), new Date(ano,3,21), new Date(ano,4,1), new Date(ano,6,9) /* Revolução Constitucionalista/SP */,
    new Date(ano,8,7), new Date(ano,9,12), new Date(ano,10,2), new Date(ano,10,15), new Date(ano,10,20),
    new Date(ano,11,25),
    addDias(p,-47), addDias(p,-46) /* Carnaval seg/ter */, addDias(p,-2) /* Sexta-feira Santa */, addDias(p,60) /* Corpus Christi */
  ];
}
/* Feriados municipais de Botucatu: propositalmente vazio. Preencher só com
   fonte oficial (lei municipal ou provimento do foro local) — nunca chutar
   data de aniversário de comarca aqui. */
const FERIADOS_LOCAIS_BOTUCATU = [];
function ehFeriado(data){
  const iso = isoDe(data);
  return feriadosNacionaisEEstaduaisSP(data.getFullYear()).some(f => isoDe(f) === iso)
      || FERIADOS_LOCAIS_BOTUCATU.includes(iso);
}
/* CPC art. 220: suspende os prazos de 20/dez a 20/jan, inclusive. */
function emRecessoForense(data){
  const m = data.getMonth(), d = data.getDate();
  return (m===11 && d>=20) || (m===0 && d<=20);
}
function diaUtil(data){
  const dow = data.getDay();
  return dow!==0 && dow!==6 && !ehFeriado(data) && !emRecessoForense(data);
}
/* Conta prazo em dias úteis a partir do dia seguinte à data-base (art. 224,
   caput, exclui o dia do começo, inclui o do vencimento). */
function calcularPrazoUteis(dataBaseISO, quantidadeDias){
  let cursor = parseData(dataBaseISO), contados = 0;
  while (contados < quantidadeDias){ cursor = addDias(cursor,1); if (diaUtil(cursor)) contados++; }
  return { data: isoDe(cursor), base: `dia útil ${quantidadeDias} a partir de ${fmtData(dataBaseISO)}, com recesso forense (20/dez–20/jan) e feriados nacionais/SP considerados` };
}

/* ==========================================================================
   Renderização
   ========================================================================== */
function renderStatus(){
  const at = new Date(DADOS.meta.atualizadoEm || Date.now());
  const horas = (Date.now() - at.getTime()) / 3600000;
  const selo = $("#selo-atualizacao"), txt = $("#txt-atualizacao");
  txt.textContent = "Atualizado em " + at.toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
  selo.className = "selo " + (horas > 48 ? "selo-perigo" : horas > 30 ? "selo-alerta" : "selo-ok");
  if (horas > 30) txt.textContent += ` — ${Math.floor(horas/24)} dia(s) sem atualizar`;

  const tarja = $("#tarja-desatualizado");
  if (horas > 36){
    const dias = Math.floor(horas/24);
    tarja.textContent = `Painel desatualizado há ${dias} dia(s) — a regeneração automática não está rodando.`;
    tarja.classList.remove("oculto");
  } else {
    tarja.classList.add("oculto");
  }

  $("#selo-hoje").textContent = new Date().toLocaleDateString("pt-BR",{weekday:"long",day:"2-digit",month:"long",year:"numeric"});

  const naoConf = todosPrazos().filter(p => !p.confirmado).length;
  const sc = $("#selo-confirmar");
  sc.classList.toggle("oculto", naoConf === 0);
  sc.innerHTML = `<i class="ponto"></i>${naoConf} prazo(s) estimado(s) aguardando confirmação`;

  const sm = $("#selo-modo");
  if (MODO_FS && raizHandle){
    sm.className = "selo selo-ok";
    sm.textContent = DADOS.casos.length ? "Pasta conectada · dados carregados do disco" : "Pasta conectada · gravação ativa";
  }
  else if (MODO_FS){ sm.className = "selo selo-alerta"; sm.textContent = "Conectar pasta para carregar os casos"; }
  else { sm.className = "selo selo-neutro"; sm.textContent = "Modo leitura · fila de arquivamento"; }
}

function renderKPIs(){
  const pr = todosPrazos(), ag = agendaCompleta();
  const vencidos = pr.filter(p => p.dias < 0 && p.tipo !== "Marco").length;
  const sete = ag.filter(p => p.dias >= 0 && p.dias <= 7).length;
  const trinta = ag.filter(p => p.dias >= 0 && p.dias <= 30).length;
  let tot = 0, feitos = 0;
  DADOS.casos.forEach(c => (c.pendencias||[]).forEach((_,i) => { tot++; if (estado.pend[c.id+"|"+i]) feitos++; }));
  const valor = DADOS.casos.reduce((s,c) => s + (c.valorCausa||0), 0);
  const alta = DADOS.casos.reduce((s,c) => s + (c.pendencias||[]).filter((p,i) => p.p === "alta" && !estado.pend[c.id+"|"+i]).length, 0);

  const cards = [
    { r:"Ações ativas", n:DADOS.casos.length, s:DADOS.casos.map(c=>c.area).join(" · "), k:"" },
    { r:"Compromissos em 7 dias", n:sete, s:trinta+" nos próximos 30 dias", k:sete>0?"k-alerta":"k-ok" },
    { r:"Pendências do cliente", n:tot-feitos, s:alta+" de prioridade alta", k:alta>0?"k-perigo":"k-ok" },
    { r:"Valor em discussão", n:valor?moeda(valor):"—", s:valor?"Soma dos valores de causa":"Nenhum valor fixado", k:"" }
  ];
  if (vencidos) cards.splice(1,0,{ r:"Prazos vencidos", n:vencidos, s:"Requer providência imediata", k:"k-perigo" });
  $("#kpis").innerHTML = cards.map(c =>
    `<div class="cartao kpi ${c.k}"><div class="rot">${c.r}</div><div class="num">${c.n}</div><div class="sub">${esc(c.s)}</div></div>`).join("");
}

const ICO = {
  perigo:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg>',
  alerta:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>',
  info:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>'
};
/* Casos já ajuizados sem número de processo: sem ele não há acompanhamento,
   nem guia, nem peticionamento. O painel precisa cobrar isso sozinho. */
function semNumeroProcesso(){
  const preAjuizamento = /pr[ée]-ajuizamento|inicial pronta|em atendimento|coleta/i;
  return DADOS.casos.filter(c => !c.numeroProcesso && !preAjuizamento.test(c.fase || ""));
}
/* M11: número presente mas com dígito verificador que não bate — sinal de
   erro de digitação, não é o mesmo problema de "número ausente". */
function numeroProcessoInvalido(){
  return DADOS.casos.filter(c => c.numeroProcesso && !validarCNJ(c.numeroProcesso).valido);
}
/* M10: protocolo tentado mas nunca confirmado, há mais de 2 dias — o caso
   mais perigoso deste painel: parece que foi feito e pode não ter sido. */
function protocolosSemConfirmar(){
  return DADOS.casos.filter(c => c.protocolo && c.protocolo.status === "tentado_sem_confirmacao"
    && c.protocolo.data && diasAte(c.protocolo.data) <= -2);
}

function renderAlertas(){
  const ordem = { perigo:0, alerta:1, info:2 }, todos = [];
  semNumeroProcesso().forEach(c => todos.push({
    nivel:"alerta", caso:c,
    txt:"<strong>Sem número de processo cadastrado.</strong> A fase indica ação já ajuizada. Sem o número não há como acompanhar andamento, emitir guia ou peticionar — informe o número para destravar."
  }));
  numeroProcessoInvalido().forEach(c => todos.push({
    nivel:"perigo", caso:c,
    txt:`<strong>Número de processo com dígito verificador inválido.</strong> "${esc(c.numeroProcesso)}" — ${esc(validarCNJ(c.numeroProcesso).motivo)}. Confira se não houve erro de digitação.`
  }));
  protocolosSemConfirmar().forEach(c => todos.push({
    nivel:"perigo", caso:c,
    txt:`<strong>Protocolo tentado sem confirmação há ${Math.abs(diasAte(c.protocolo.data))} dia(s).</strong> Verifique se o protocolo em ${fmtData(c.protocolo.data)} realmente entrou nos autos.`
  }));
  DADOS.casos.forEach(c => pendenciasDataBaseFaltante(c).forEach(txt => todos.push({
    nivel:"perigo", caso:c, txt:`<strong>Data-base faltando para calcular prazo.</strong> ${esc(txt)}`
  })));
  DADOS.casos.forEach(c => (c.alertas||[]).forEach(a => {
    let txt = a.txt;
    if (a.ultimaVez){
      const dias = Math.round((hojeLocal() - parseData(a.ultimaVez)) / 86400000);
      const desde = a.primeiraVez ? ` (desde ${fmtData(a.primeiraVez)}${a.contagem?`, visto ${a.contagem}x`:""})` : "";
      txt += ` <span class="alerta-inalterado">— inalterado há ${dias} dia(s)${desde}</span>`;
    }
    todos.push(Object.assign({}, a, { caso:c, txt }));
  }));
  todos.sort((a,b) => ordem[a.nivel] - ordem[b.nivel]);
  $("#alertas").innerHTML = todos.length ? todos.map(a =>
    `<div class="alerta-item a-${a.nivel}" data-busca="${esc(a.txt.replace(/<[^>]+>/g,"") + " " + a.caso.cliente)}">
       ${ICO[a.nivel]}<div><div class="alerta-caso">${esc(a.caso.cliente)}</div>${a.txt}</div></div>`
  ).join("") : '<div class="vazio-msg">Nenhum alerta no momento.</div>';
}

/* ==========================================================================
   Trilha de vencidos (M15) — prazo crítico que passou não some: fica
   visível até alguém registrar um desfecho com data e justificativa.
   ========================================================================== */
function prazosVencidosSemDesfecho(){
  return todosPrazos().filter(p => p.critico && p.dias < 0 && !p.resolvido);
}
function renderVencidos(){
  const lista = prazosVencidosSemDesfecho();
  const bloco = $("#vencidos-bloco");
  bloco.classList.toggle("oculto", lista.length === 0);
  if (!lista.length) return;
  $("#vencidos-lista").innerHTML = lista.map(p => `<li>
    <div class="data"><div class="d">${String(parseData(p.data).getDate()).padStart(2,"0")}</div><div class="m">${MES_ABR[parseData(p.data).getMonth()]}</div></div>
    <div class="corpo">
      <div class="tit">${esc(p.titulo)} <span class="rel venc">${fmtRelativo(p.dias)}</span></div>
      <div class="meta"><span>${esc(p.caso.cliente)}</span></div>
      <div class="vencido-form">
        <select data-desfecho-tipo="${p.chave}">
          <option value="">Registrar desfecho…</option>
          <option value="cumprido">Cumprido</option>
          <option value="perdido">Perdido</option>
          <option value="prejudicado">Prejudicado</option>
          <option value="reagendado">Reagendado</option>
        </select>
        <input type="text" data-desfecho-just="${p.chave}" placeholder="justificativa (obrigatória)">
        <button class="btn-icone" data-desfecho-salvar="${p.chave}">Salvar</button>
      </div>
    </div></li>`).join("");
}
function registrarDesfechoVencido(chave){
  const tipo = $(`[data-desfecho-tipo="${chave}"]`).value;
  const just = $(`[data-desfecho-just="${chave}"]`).value.trim();
  if (!tipo){ toast("Escolha o tipo de desfecho.","alerta"); return; }
  if (!just){ toast("A justificativa é obrigatória.","alerta"); return; }
  estado.vencidos[chave] = { tipo, justificativa:just, data:isoDe(hojeLocal()) };
  salvar(); renderTudo();
  toast("Desfecho registrado.","ok");
}

/* ==========================================================================
   Score de risco (M19) — critério visível em cada linha, nada de mágico.
   ========================================================================== */
/* Roda uma vez por renderTudo(): registra quando cada pendência de
   prioridade alta em aberto foi vista pela primeira vez, para o score de
   risco poder medir "parada há mais de 14 dias". Grava uma vez só. */
function atualizarPendPrimeiraVez(){
  let mudou = false;
  DADOS.casos.forEach(c => (c.pendencias||[]).forEach((p,i) => {
    if (p.p !== "alta" || estado.pend[c.id+"|"+i]) return;
    const chave = c.id+"|"+i;
    if (!estado.pendPrimeiraVez[chave]){ estado.pendPrimeiraVez[chave] = Date.now(); mudou = true; }
  }));
  if (mudou) salvar();
}
/* Agrupa todosPrazos() por caso uma única vez — scoreRisco() é chamado uma
   vez por caso a cada render; sem isto, cada chamada recalcularia os
   prazos (inclusive os que envolvem calcularPrazoUteis) para todos os
   casos de novo, custo O(n²) no número de casos. */
function prazosPorCaso(){
  const mapa = new Map();
  todosPrazos().forEach(p => { if (!mapa.has(p.caso.id)) mapa.set(p.caso.id, []); mapa.get(p.caso.id).push(p); });
  return mapa;
}
function scoreRisco(c, prazosCaso){
  const criterios = [];
  prazosCaso = prazosCaso || todosPrazos().filter(p => p.caso.id === c.id);
  if (prazosCaso.some(p => p.critico && p.dias < 0 && !p.resolvido)){ criterios.push("prazo vencido sem desfecho"); }
  if (c.protocolo && c.protocolo.status === "tentado_sem_confirmacao" && c.protocolo.data && diasAte(c.protocolo.data) <= -2)
    criterios.push("protocolo sem confirmar");
  if (prazosCaso.some(p => p.critico && p.dias >= 0 && p.dias <= 7)) criterios.push("prazo crítico em até 7 dias");
  const pendAlta = (c.pendencias||[]).some((p,i) => {
    if (p.p !== "alta" || estado.pend[c.id+"|"+i]) return false;
    const vistoEm = estado.pendPrimeiraVez[c.id+"|"+i];
    return vistoEm && (Date.now() - vistoEm) / 86400000 > 14;
  });
  if (pendAlta) criterios.push("pendência alta parada há mais de 14 dias");
  if (prazosCaso.some(p => /prescri/i.test(p.tipo||p.titulo||"") && p.dias >= 0 && p.dias <= 90)) criterios.push("prescrição em até 90 dias");
  return { pontos: criterios.length * 10, criterios };
}

function itemTL(p, mostrarCaso){
  const d = parseData(p.data), n = nivelPrazo(p);
  const cls = n === "venc" ? "venc" : n === "urg" ? "urg" : "";
  const selo = (p.origem === "google" || p.origem === "outlook" || p.origem === "externa")
    ? `<span class="selo selo-neutro mini">${esc(p.rotuloFonte || "agenda externa")}</span>`
    : p.origem === "escritorio"
    ? (p.vinculado ? `<span class="selo selo-ok mini">${esc(p.vinculado.cliente)}</span>` : `<span class="selo selo-info mini">escritório</span>`)
    : p.calculado ? `<span class="selo selo-ok mini" title="${esc(p.baseCalculo||"")}">calculado — art. 224 CPC</span>`
    : p.confirmado ? `<span class="selo selo-ok mini">confirmado</span>`
    : `<button class="selo selo-alerta mini bt" data-confirmar="${p.chave}" title="Marcar como conferido por você">estimado · confirmar</button>`;
  return `<li class="${cls}" data-busca="${esc(p.titulo + " " + p.caso.cliente + " " + (p.nota||""))}">
    <div class="data"><div class="d">${String(d.getDate()).padStart(2,"0")}</div><div class="m">${MES_ABR[d.getMonth()]} ${String(d.getFullYear()).slice(2)}</div></div>
    <div class="corpo">
      <div class="tit">${p.hora?`<span class="hora">${esc(p.hora)}</span> `:""}${esc(p.titulo)}</div>
      <div class="meta">
        <span class="selo selo-neutro mini">${esc(p.tipo||"Compromisso")}</span>
        ${mostrarCaso ? `<span>${esc(p.caso.cliente)}</span>` : ""}
        <span class="rel ${n}">${fmtRelativo(p.dias)}</span>
        ${p.local ? `<span>· ${esc(p.local)}</span>` : ""}
        ${selo}
      </div>
      ${p.nota ? `<div class="nota">${esc(p.nota)}</div>` : ""}
    </div></li>`;
}
function renderTimelines(){
  const ag = agendaCompleta();
  const prox = ag.filter(p => p.dias >= -30 && p.dias <= 45);
  $("#tl-proximos").innerHTML = prox.length ? prox.map(p => itemTL(p,true)).join("") : '<div class="vazio-msg">Nada nos próximos 45 dias.</div>';
  $("#tl-todos").innerHTML = ag.length ? ag.map(p => itemTL(p,true)).join("") : '<div class="vazio-msg">Agenda vazia.</div>';
}

/* M19: quando "Ordenar por risco" está ligado, casos com score maior vêm
   primeiro; o critério de cada um fica visível, nunca é mágico. */
function casosOrdenados(){
  const mapa = prazosPorCaso();
  const lista = DADOS.casos.map(c => ({ caso:c, score:scoreRisco(c, mapa.get(c.id)||[]) }));
  return estado.ordemRisco ? lista.sort((a,b) => b.score.pontos - a.score.pontos) : lista;
}
function badgeRisco(score){
  if (!score.criterios.length) return "";
  return `<div class="linha-risco" title="${esc(score.criterios.join(" · "))}">⚠ ${score.criterios.map(esc).join(" · ")}</div>`;
}

function renderMiniCasos(){
  atualizarPendPrimeiraVez();
  $("#mini-casos").innerHTML = casosOrdenados().map(({caso:c, score}) => {
    const pend = c.pendencias || [];
    const tot = pend.length, feitos = pend.filter((_,i) => estado.pend[c.id+"|"+i]).length;
    const pct = tot ? Math.round(feitos/tot*100) : 0;
    const prox = todosPrazos().filter(p => p.caso.id === c.id && p.dias >= 0)[0];
    return `<div class="cartao cartao-p zona" data-caso="${c.id}" data-busca="${esc(c.cliente+" "+c.titulo)}">
      <div class="linha-topo">
        <div><div class="nome-caso">${esc(c.cliente)}</div><div class="sub-caso">${esc(c.area)}</div></div>
        <span class="selo selo-${c.statusTipo}">${esc(c.status)}</span>
      </div>
      ${badgeRisco(score)}
      <div class="rot-prog">Instrução do caso — ${feitos} de ${tot} itens</div>
      <div class="progresso"><i style="width:${pct}%"></i></div>
      <div class="prox-linha">${prox ? `Próximo: <strong>${esc(prox.titulo)}</strong> — ${fmtData(prox.data)} (${fmtRelativo(prox.dias)})` : "Sem prazos futuros registrados."}</div>
      <div class="acoes">
        <button class="btn-icone" data-ir-caso="${c.id}">Ver detalhes</button>
        <button class="btn-icone" data-copiar="${c.id}">Copiar resumo</button>
        <button class="btn-icone" data-escolher="${c.id}">Enviar arquivo</button>
      </div>
      <div class="dica-solta">Solte para arquivar neste caso</div>
    </div>`;
  }).join("");
  ligarZonas();
}

const PROTOCOLO_ROTULO = { nao_aplicavel:null, pendente:"Protocolo pendente", tentado_sem_confirmacao:"Protocolo sem confirmar", confirmado:"Protocolo confirmado" };
const PROTOCOLO_SELO = { pendente:"alerta", tentado_sem_confirmacao:"perigo", confirmado:"ok" };
function renderCasos(){
  $("#casos-lista").innerHTML = casosOrdenados().map(({caso:c, score}) => {
    const campos = [["Área",c.area],["Fase",c.fase],["Parte contrária",c.parteContraria],
      ["Nº do processo",c.numeroProcesso || (semNumeroProcesso().includes(c) ? "⚠ FALTA — informar" : null)],["Foro",c.foro],["Valor da causa",moeda(c.valorCausa)],["Responsável",c.responsavel]];
    const prazos = todosPrazos().filter(p => p.caso.id === c.id)
      .concat(compromissos().filter(p => p.casoId === c.id))
      .sort((a,b) => a.data < b.data ? -1 : 1);
    return `<details class="cartao caso" id="caso-${c.id}" data-busca="${esc(c.cliente+" "+c.titulo+" "+(c.resumo||"")+" "+(c.tese||""))}">
      <summary class="caso-cab">
        <svg class="seta" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg>
        <div class="cab-txt">
          <h3>${esc(c.cliente)}${c.clienteObs ? ` <span class="obs">(${esc(c.clienteObs)})</span>` : ""}</h3>
          <div class="linha2"><span class="selo selo-${c.statusTipo}">${esc(c.status)}</span><span>${esc(c.titulo)}</span>
            ${c.protocolo && PROTOCOLO_ROTULO[c.protocolo.status] ? `<span class="selo selo-${PROTOCOLO_SELO[c.protocolo.status]} mini">${esc(PROTOCOLO_ROTULO[c.protocolo.status])}</span>` : ""}
          </div>
          ${badgeRisco(score)}
        </div>
      </summary>
      <div class="caso-corpo">
        <div class="campos">${campos.map(([r,v]) =>
          `<div class="campo"><div class="r">${r}</div><div class="v ${v?"":"vazio"}">${v?esc(v):"a definir"}</div></div>`).join("")}</div>
        ${c.resumo ? `<div class="bloco"><h4>Resumo dos fatos</h4><p>${esc(c.resumo)}</p></div>` : ""}
        ${c.tese ? `<div class="bloco"><h4>Tese e estratégia</h4><p>${esc(c.tese)}</p></div>` : ""}
        ${(c.contatos||[]).length ? `<div class="bloco"><h4>Contatos</h4><p>${c.contatos.map(k =>
          `${esc(k.nome)}${k.tel ? ` — <a href="tel:${k.tel.replace(/[^+\d]/g,"")}">${esc(k.tel)}</a>` : ""}`).join("<br>")}</p></div>` : ""}
        <div class="bloco"><h4>Prazos e compromissos</h4><ul class="tl compacta">${prazos.map(p => itemTL(p,false)).join("")}</ul></div>
        ${pendenciasDataBaseFaltante(c).length ? `<div class="bloco"><h4>Data-base faltando</h4><p>${pendenciasDataBaseFaltante(c).map(t => "· " + esc(t)).join("<br>")}</p></div>` : ""}
        ${(c.docs||[]).length ? `<div class="bloco"><h4>Documentos do caso</h4><p>${c.docs.map(d => "· " + esc(d)).join("<br>")}</p></div>` : ""}
        <div class="acoes">
          <a class="btn-icone" href="${urlPasta(c.pasta)}">Abrir pasta no Windows</a>
          <button class="btn-icone" data-ver-arquivos="${c.id}">Ver arquivos no painel</button>
          <button class="btn-icone" data-copiar="${c.id}">Copiar resumo</button>
        </div>
      </div></details>`;
  }).join("");
}

function renderPendencias(){
  $("#v-pend").innerHTML = DADOS.casos.map(c => {
    const pend = c.pendencias || [];
    const faltantes = pendenciasDataBaseFaltante(c);
    const tot = pend.length, feitos = pend.filter((_,i) => estado.pend[c.id+"|"+i]).length;
    const pct = tot ? Math.round(feitos/tot*100) : 0;
    return `<h2 class="secao">${esc(c.cliente)} — ${feitos}/${tot} concluídos</h2>
      <div class="cartao cartao-p mb18">
        <div class="progresso mb12"><i style="width:${pct}%"></i></div>
        <ul class="pend">${pend.map((p,i) => {
          const k = c.id + "|" + i, f = !!estado.pend[k];
          return `<li class="${f?"feito":""}" data-busca="${esc(p.t+" "+c.cliente)}">
            <input type="checkbox" id="pd-${k}" data-pend="${k}" ${f?"checked":""}>
            <label class="txt" for="pd-${k}">${esc(p.t)}</label>
            <span class="tag t-${p.p}">${p.p}</span></li>`;
        }).join("")}
        ${faltantes.map(t => `<li data-busca="${esc(t+" "+c.cliente)}">
            <input type="checkbox" disabled title="Derivado automaticamente — some quando a data-base for preenchida">
            <label class="txt">${esc(t)}</label>
            <span class="tag t-alta" title="Derivado automaticamente do cálculo de prazo">alta · automático</span></li>`).join("")}</ul>
      </div>`;
  }).join("");
}

/* ---------- Calendário ---------- */
function montarCalendario(alvoTitulo, alvoCorpo, ref, eventos){
  const ano = ref.getFullYear(), mes = ref.getMonth();
  $(alvoTitulo).textContent = MESES[mes] + " de " + ano;
  const hj = hojeLocal(), cur = new Date(ano, mes, 1 - new Date(ano,mes,1).getDay());
  let html = "";
  for (let s = 0; s < 6; s++){
    html += "<tr>";
    for (let d = 0; d < 7; d++){
      const iso = isoDe(cur);
      const fora = cur.getMonth() !== mes, eHoje = cur.getTime() === hj.getTime(), fds = d === 0 || d === 6;
      const evs = eventos.filter(p => p.data === iso);
      html += `<td class="dia ${fora?"fora":""} ${eHoje?"hoje":""} ${fds&&!eHoje?"fds":""}" data-dia="${iso}"
                   title="Duplo clique para criar um compromisso em ${fmtData(iso)}">
        <div class="dnum">${cur.getDate()}</div>
        ${evs.map(p => {
          const n = nivelPrazo(p);
          const cor = p.origem === "google" ? "e-google"
                    : p.origem === "outlook" ? "e-outlook"
                    : p.origem === "externa" ? "e-info"
                    : p.origem === "escritorio" ? (p.vinculado ? "e-ok" : "e-info")
                    : n === "venc" ? "e-perigo" : n === "urg" ? "e-alerta" : "";
          return `<button class="ev ${cor}" data-ev="${p.chave}" title="${esc((p.hora?p.hora+" · ":"") + p.titulo + " — " + p.caso.cliente)}">${p.hora?esc(p.hora)+" ":""}${esc(p.titulo)}</button>`;
        }).join("")}
        <span class="mais-dia" aria-hidden="true">+</span></td>`;
      cur.setDate(cur.getDate() + 1);
    }
    html += "</tr>";
    if (cur.getMonth() !== mes && s >= 4) break;
  }
  const corpo = $(alvoCorpo);
  corpo.innerHTML = html;
  $$("td.dia", corpo).forEach(td => {
    td.addEventListener("dblclick", e => {
      if (e.target.closest(".ev")) return;       // duplo clique no evento não cria outro
      abrirFormCompromisso(null, td.dataset.dia);
    });
  });
}
let calRef = new Date(hojeLocal().getFullYear(), hojeLocal().getMonth(), 1);
let calEscRef = new Date(hojeLocal().getFullYear(), hojeLocal().getMonth(), 1);
function renderCalendario(){
  montarCalendario("#cal-titulo","#cal-corpo", calRef, agendaCompleta());
  const box = $("#fontes-agenda"); if (!box) return;
  const linhas = [`<div><b>Prazos e casos</b> — ${todosPrazos().length} · <b>Escritório</b> — ${compromissos().length}</div>`];
  if (fontesAgenda.length){
    fontesAgenda.forEach(f => linhas.push(
      `<div><b>${esc(f.rotulo)}</b> — ${f.erro ? "erro ao ler: " + esc(f.erro) : f.total + " evento(s)"}${
        f.mod ? " · atualizado em " + new Date(f.mod).toLocaleDateString("pt-BR") : ""}</div>`));
  } else {
    linhas.push('<div class="vazia">Nenhuma agenda externa carregada. Coloque os .ics em <code>02_CONTROLE/painel/agendas/</code> e clique em Carregar do Drive.</div>');
  }
  box.innerHTML = linhas.join("");
}
function renderCalEscritorio(){ montarCalendario("#cale-titulo","#cale-corpo", calEscRef, compromissos()); }

/* ==========================================================================
   Aba ESCRITÓRIO
   ========================================================================== */
const TIPOS_COMPROMISSO = ["Atendimento","Reunião","Audiência","Perícia","Diligência","Ligação","Prazo interno","Pessoal","Outro"];
function renderEscritorio(){
  const lista = compromissos();
  const hoje = lista.filter(c => c.dias === 0);
  const semana = lista.filter(c => c.dias > 0 && c.dias <= 7);
  const depois = lista.filter(c => c.dias > 7);
  const passados = lista.filter(c => c.dias < 0).slice(-10).reverse();

  const bloco = (titulo, arr, vazio) => `
    <h2 class="secao">${titulo} ${arr.length ? `<span class="cnt">${arr.length}</span>` : ""}</h2>
    <div class="cartao cartao-p mb18">${arr.length
      ? `<ul class="tl">${arr.map(itemCompromisso).join("")}</ul>`
      : `<div class="vazio-msg">${vazio}</div>`}</div>`;

  $("#esc-listas").innerHTML =
    bloco("Hoje", hoje, "Nenhum compromisso hoje.") +
    bloco("Próximos 7 dias", semana, "Semana livre.") +
    bloco("Mais adiante", depois, "Nada agendado além da semana.") +
    (passados.length ? bloco("Realizados recentemente", passados, "") : "");
  renderCalEscritorio();
}
function itemCompromisso(c){
  const d = parseData(c.data), n = nivelPrazo(c);
  return `<li class="${n==="venc"?"passado":n==="urg"?"urg":""}" data-busca="${esc(c.titulo+" "+(c.pessoa||"")+" "+(c.local||"")+" "+(c.nota||""))}">
    <div class="data"><div class="d">${String(d.getDate()).padStart(2,"0")}</div><div class="m">${MES_ABR[d.getMonth()]}</div></div>
    <div class="corpo">
      <div class="tit">${c.hora?`<span class="hora">${esc(c.hora)}</span> `:""}${esc(c.titulo)}</div>
      <div class="meta">
        <span class="selo selo-neutro mini">${esc(c.tipo||"Compromisso")}</span>
        ${c.pessoa?`<span>${esc(c.pessoa)}</span>`:""}
        ${c.local?`<span>· ${esc(c.local)}</span>`:""}
        <span class="rel ${n}">${fmtRelativo(c.dias)}</span>
        ${c.vinculado
          ? `<button class="selo selo-ok mini bt" data-ir-caso="${c.vinculado.id}" title="Abrir o caso">${esc(c.vinculado.cliente)}</button>`
          : `<span class="selo selo-neutro mini">escritório</span>`}
      </div>
      ${c.nota?`<div class="nota">${esc(c.nota)}</div>`:""}
    </div>
    <div class="acoes-item">
      <button class="btn-icone mini" data-edit-comp="${c.indice}" title="Editar">editar</button>
      <button class="btn-icone mini perigo" data-del-comp="${c.indice}" title="Excluir">excluir</button>
    </div></li>`;
}
function abrirFormCompromisso(indice, dataPre){
  const c = indice != null ? estado.compromissos[indice] : null;
  $("#f-caso").innerHTML = `<option value="">Movimentação do escritório (sem caso)</option>` +
    DADOS.casos.map(x => `<option value="${x.id}">${esc(x.cliente)}</option>`).join("");
  $("#f-indice").value = indice != null ? indice : "";
  $("#f-titulo").value = c ? c.titulo : "";
  $("#f-data").value   = c ? c.data : (dataPre || isoDe(hojeLocal()));
  $("#f-hora").value   = c ? (c.hora||"") : "";
  $("#f-tipo").value   = c ? (c.tipo||"Atendimento") : "Atendimento";
  $("#f-pessoa").value = c ? (c.pessoa||"") : "";
  $("#f-local").value  = c ? (c.local||"") : "";
  $("#f-nota").value   = c ? (c.nota||"") : "";
  $("#f-caso").value   = c ? (c.casoId||"") : "";
  $("#form-titulo").textContent = indice != null ? "Editar compromisso" : "Novo compromisso";
  $("#f-sugestao").classList.add("oculto");
  $("#dlg-comp").showModal();
  setTimeout(() => $("#f-titulo").focus(), 50);
}
/* Enquanto digita, propõe o caso — sem nunca decidir sozinho. */
function avaliarSugestao(){
  const box = $("#f-sugestao");
  if ($("#f-caso").value){ box.classList.add("oculto"); return; }
  const s = sugerirCaso([$("#f-titulo").value, $("#f-pessoa").value, $("#f-nota").value].join(" "));
  if (!s){ box.classList.add("oculto"); return; }
  box.classList.remove("oculto");
  box.innerHTML = `Parece ser do caso <strong>${esc(s.caso.cliente)}</strong>
    <button type="button" class="btn-icone mini" id="f-aceitar-sug">vincular</button>
    <button type="button" class="btn-icone mini" id="f-ignorar-sug">é do escritório</button>`;
  $("#f-aceitar-sug").addEventListener("click", () => { $("#f-caso").value = s.caso.id; box.classList.add("oculto"); });
  $("#f-ignorar-sug").addEventListener("click", () => box.classList.add("oculto"));
}
function salvarCompromisso(ev){
  ev.preventDefault();
  const t = $("#f-titulo").value.trim(), data = $("#f-data").value;
  if (!t || !data){ toast("Título e data são obrigatórios.","alerta"); return; }
  const casoId = $("#f-caso").value || null;
  const item = { titulo:t, data, hora:$("#f-hora").value||null, tipo:$("#f-tipo").value,
                 pessoa:$("#f-pessoa").value.trim()||null, local:$("#f-local").value.trim()||null,
                 nota:$("#f-nota").value.trim()||null, casoId, semVinculo: !casoId };
  const idx = $("#f-indice").value;
  if (idx === "") estado.compromissos.push(item); else estado.compromissos[+idx] = item;
  salvar(); $("#dlg-comp").close(); renderTudo();
  toast(idx === "" ? "Compromisso criado." : "Compromisso atualizado.", "ok");
}

/* ==========================================================================
   Aba ARQUIVOS
   ========================================================================== */
let casoAberto = null, subAberta = null;
const SUBPASTAS = ["01_Documentos do Cliente","02_Peticoes e Manifestacoes","03_Guias e Comprovantes",
                   "04_Estrategia e Anotacoes Internas","05_Correspondencia com Cliente"];
async function renderArquivos(){
  const wrap = $("#arq-conteudo");
  if (!MODO_FS){
    wrap.innerHTML = `<div class="cartao cartao-p aviso-modo">
      <h4>Navegação de pastas indisponível neste modo</h4>
      <p>O painel foi aberto como arquivo local (<code>file://</code>), e o navegador não autoriza leitura de pastas nesse contexto.
      Abra pelo endereço publicado ou pelo atalho local para navegar aqui dentro. Enquanto isso, use os links abaixo,
      que abrem a pasta no Explorador do Windows. O arrastar continua funcionando: os arquivos entram na fila de arquivamento.</p>
      <ul class="pasta-lista">${DADOS.casos.map(c =>
        `<li><a href="${urlPasta(c.pasta)}">${icoPasta()}<span>${esc(c.cliente)}<small>${esc(c.titulo)}</small></span></a></li>`).join("")}</ul>
    </div>` + filaHTML();
    return;
  }
  if (!raizHandle){
    wrap.innerHTML = `<div class="cartao cartao-p aviso-modo">
      <h4>Conecte a pasta do escritório</h4>
      <p>Autorize o acesso à pasta <code>ADVOCACIA</code> uma única vez. O navegador guarda a permissão e o painel
      passa a listar, abrir e gravar arquivos direto nas pastas dos casos.</p>
      <button class="btn-principal" id="bt-conectar-2">Conectar pasta ADVOCACIA</button>
    </div>` + filaHTML();
    $("#bt-conectar-2").addEventListener("click", conectarPasta);
    return;
  }
  const c = DADOS.casos.find(x => x.id === casoAberto) || DADOS.casos[0];
  if (!c){ wrap.innerHTML = '<div class="vazio-msg">Nenhum caso cadastrado.</div>'; return; }
  casoAberto = c.id;
  if (!SUBPASTAS.includes(subAberta)) subAberta = SUBPASTAS[0];

  wrap.innerHTML = `
    <div class="arq-topo">
      <select id="arq-caso" aria-label="Selecionar caso">${DADOS.casos.map(x =>
        `<option value="${x.id}" ${x.id===c.id?"selected":""}>${esc(x.cliente)}</option>`).join("")}</select>
      <div class="trilha">${esc(c.pasta.split("/").slice(-1)[0])} <span>›</span> ${esc(subAberta)}</div>
      <span class="espaco"></span>
      <a class="btn-icone" href="${urlPasta(c.pasta)}">Abrir no Windows</a>
    </div>
    <div class="arq-grade">
      <nav class="arq-subs">${SUBPASTAS.map(s =>
        `<button class="${s===subAberta?"ativo":""}" data-sub="${esc(s)}">${esc(s.replace(/^\d\d_/,""))}</button>`).join("")}</nav>
      <div class="cartao cartao-p zona" id="arq-lista" data-caso="${c.id}">
        <div class="vazio-msg">Carregando…</div>
        <div class="dica-solta">Solte arquivos aqui</div>
      </div>
    </div>` + filaHTML();

  $("#arq-caso").addEventListener("change", e => { casoAberto = e.target.value; renderArquivos(); });
  $$(".arq-subs button").forEach(b => b.addEventListener("click", () => { subAberta = b.dataset.sub; renderArquivos(); }));
  ligarZonas();

  try {
    const partes = c.pasta.split("/"), i = partes.indexOf("01_CLIENTES");
    const itens = await listarPasta(partes.slice(i).concat([subAberta]));
    const reais = itens.filter(x => x.tipo === "file");
    $("#arq-lista").innerHTML = (reais.length
      ? `<ul class="arq-itens">${reais.map(f => `<li>
          <span class="arq-ico">${icoArquivo(f.nome)}</span>
          <span class="arq-nome" title="${esc(f.nome)}">${esc(f.nome)}</span>
          <span class="arq-meta">${fmtTam(f.tam)}${f.mod?" · "+new Date(f.mod).toLocaleDateString("pt-BR"):""}</span>
          <button class="btn-icone mini" data-abrir="${esc(f.nome)}">abrir</button></li>`).join("")}</ul>`
      : `<div class="vazio-msg">Pasta vazia. Arraste arquivos para cá.</div>`)
      + `<div class="dica-solta">Solte arquivos aqui</div>`;
    ligarZonas();
    $$("[data-abrir]").forEach(b => b.addEventListener("click", async () => {
      const f = reais.find(x => x.nome === b.dataset.abrir);
      if (!f) return;
      const file = await f.handle.getFile();
      const u = URL.createObjectURL(file);
      window.open(u, "_blank");
      setTimeout(() => URL.revokeObjectURL(u), 60000);
    }));
  } catch(e){
    $("#arq-lista").innerHTML = `<div class="vazio-msg">Não foi possível ler a pasta: ${esc(e.message)}</div>`;
  }
}
function icoPasta(){ return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>'; }
function icoArquivo(n){
  const e = (n.match(/\.([^.]+)$/)||["",""])[1].toLowerCase();
  const cor = /pdf/.test(e) ? "#c0392b" : /docx?|odt/.test(e) ? "#2b579a" : /xlsx?|csv/.test(e) ? "#1e7145"
            : /jpe?g|png|gif|heic|webp/.test(e) ? "#8e44ad" : /mp4|mov|avi/.test(e) ? "#d68910" : "#8a99a8";
  return `<svg viewBox="0 0 24 24" fill="none" stroke="${cor}" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>`;
}
function filaHTML(){
  const f = estado.fila || [];
  if (!f.length) return "";
  const pend = f.filter(x => x.estado === "pendente");
  return `<h2 class="secao">Fila de arquivamento ${pend.length?`<span class="cnt">${pend.length} pendente(s)</span>`:""}</h2>
    <div class="cartao cartao-p">
      ${pend.length ? `<p class="ajuda">Estes arquivos foram classificados mas ainda precisam ser movidos por você. Clique em <em>copiar destino</em> e cole no Explorador do Windows.</p>` : ""}
      <ul class="fila">${f.slice(0,40).map((x,i) => `<li class="${x.estado}">
        <span class="fl-ico">${x.estado === "arquivado" ? "✓" : "•"}</span>
        <div class="fl-corpo">
          <div class="fl-nome">${esc(x.arquivo)} ${x.certeza === "baixa" ? '<span class="selo selo-alerta mini">classificação incerta</span>' : ""}</div>
          <div class="fl-meta">${esc(x.caso)} → <code>${esc(x.destino)}</code></div>
          <div class="fl-meta">Renomear para: <strong>${esc(x.nomeFinal)}</strong></div>
        </div>
        <div class="acoes-item">
          <button class="btn-icone mini" data-copiar-destino="${i}">copiar destino</button>
          ${x.estado === "pendente" ? `<button class="btn-icone mini" data-feito-fila="${i}">marcar movido</button>` : ""}
          <button class="btn-icone mini perigo" data-del-fila="${i}">remover</button>
        </div></li>`).join("")}</ul>
      <div class="acoes mt12"><button class="btn-icone" id="bt-limpar-fila">Limpar itens já arquivados</button></div>
    </div>`;
}

/* ==========================================================================
   Aba ACESSOS (sem senhas — por decisão de segurança)
   ========================================================================== */
const PORTAIS = [
  { id:"meuinss",      nome:"Meu INSS / gov.br",         p:"Extrato CNIS, CAT, benefícios (B91)",  dono:"Cliente" },
  { id:"esaj",         nome:"e-SAJ TJSP",                p:"Peticionamento e consulta processual", dono:"Escritório" },
  { id:"pje",          nome:"PJe / Justiça do Trabalho", p:"Peticionamento trabalhista",           dono:"Escritório" },
  { id:"conect",       nome:"Conectividade Social",      p:"Extrato de FGTS do empregador",        dono:"Cliente/Empresa" },
  { id:"esocial",      nome:"eSocial / CTPS Digital",    p:"Vínculos e remunerações",              dono:"Cliente" },
  { id:"portalcustas", nome:"Portal de Custas TJSP",     p:"Emissão de guias e preparo",           dono:"Escritório" },
  { id:"sus",          nome:"Prontuário / Ouvidoria SUS",p:"Prontuário integral e reclamações",    dono:"Cliente" }
];
const ST_ACESSO = ["nao_aplica","a_solicitar","solicitado","obtido","negado"];
const ST_ROTULO = { nao_aplica:"não se aplica", a_solicitar:"a solicitar", solicitado:"solicitado", obtido:"obtido", negado:"negado" };
const ST_CLASSE = { nao_aplica:"neutro", a_solicitar:"alerta", solicitado:"info", obtido:"ok", negado:"perigo" };

function renderAcessos(){
  if (!$("#v-acessos")) return;             // aba desativada — nada a renderizar
  const linhas = DADOS.casos.map(c => `
    <h2 class="secao">${esc(c.cliente)}</h2>
    <div class="cartao cartao-p mb18">
      <table class="tab-acessos">
        <thead><tr><th>Portal</th><th>Para quê</th><th>Quem detém</th><th>Situação</th><th>Anotação</th></tr></thead>
        <tbody>${PORTAIS.map(p => {
          const k = c.id + "|" + p.id;
          const a = estado.acessos[k] || { st:"a_solicitar", nota:"" };
          return `<tr data-busca="${esc(p.nome+" "+c.cliente)}">
            <td><strong>${esc(p.nome)}</strong></td>
            <td class="dim">${esc(p.p)}</td>
            <td class="dim">${esc(p.dono)}</td>
            <td><select data-acesso-st="${k}" class="sel-${ST_CLASSE[a.st]}">${ST_ACESSO.map(s =>
              `<option value="${s}" ${s===a.st?"selected":""}>${ST_ROTULO[s]}</option>`).join("")}</select></td>
            <td><input type="text" data-acesso-nota="${k}" value="${esc(a.nota||"")}" placeholder="ex.: procuração digital pedida em 05/08"></td>
          </tr>`;
        }).join("")}</tbody>
      </table>
    </div>`).join("");

  $("#v-acessos").innerHTML = `
    <div class="cartao cartao-p aviso-seguranca">
      ${ICO.perigo}
      <div><strong>Este painel não armazena senhas — de propósito.</strong>
      Credencial gov.br é pessoal e intransferível, e um arquivo em nuvem sincronizada é o pior lugar possível para guardá-la.
      Aqui você controla <em>o que falta destravar</em> em cada caso. O segredo em si fica no gerenciador.</div>
    </div>
    ${linhas}
    <h2 class="secao">Como fazer isso do jeito certo</h2>
    <div class="grade g2">
      <div class="cartao cartao-p guia">
        <h4>Gerenciador de senhas (Bitwarden, gratuito)</h4>
        <ol>
          <li>Crie a conta em <strong>bitwarden.com</strong> e instale a extensão no Chrome e o app no celular.</li>
          <li>Ative a verificação em duas etapas na própria conta do Bitwarden — é o cofre de tudo.</li>
          <li>Crie uma <strong>pasta por cliente</strong>, no mesmo padrão das pastas do Drive.</li>
          <li>Guarde ali apenas o que for legitimamente do escritório: e-SAJ, PJe, Portal de Custas.</li>
          <li>No campo de observação de cada item, anote a data em que o acesso foi concedido e por quem.</li>
          <li>O plano gratuito já cobre cofre pessoal ilimitado em todos os dispositivos.</li>
        </ol>
      </div>
      <div class="cartao cartao-p guia">
        <h4>Acesso do cliente: peça procuração, não a senha</h4>
        <p>Pedir a senha gov.br do cliente cria três problemas: viola os termos de uso do portal, transfere para você a
        responsabilidade por tudo que for feito naquela conta, e enfraquece a prova se a origem do documento for questionada.</p>
        <ol>
          <li><strong>Meu INSS:</strong> o cliente pode cadastrar procurador no próprio portal, vinculando o seu CPF.
          Você passa a acessar com a <em>sua</em> conta gov.br, com trilha de auditoria em seu nome.</li>
          <li><strong>Alternativa imediata:</strong> peça ao cliente que gere o PDF (extrato CNIS, CAT, comunicado de decisão)
          e envie. Vale como documento e não expõe credencial.</li>
          <li><strong>Se nada funcionar:</strong> requerimento administrativo ou, em juízo, pedido de exibição
          (arts. 396 a 400 do CPC) — que ainda tem a vantagem de constituir prova da recusa.</li>
        </ol>
      </div>
    </div>`;
}

/* ---------- Contadores das abas ---------- */
function renderPills(){
  $("#p-casos").textContent = DADOS.casos.length;
  const ag = agendaCompleta(), urg = ag.filter(p => p.dias >= 0 && p.dias <= 7).length;
  const pa = $("#p-agenda"); pa.textContent = ag.length; pa.classList.toggle("urgente", urg > 0);
  const comps = compromissos();
  const pe = $("#p-esc");
  pe.textContent = comps.filter(c => c.dias >= 0).length;
  pe.classList.toggle("urgente", comps.filter(c => c.dias >= 0 && c.dias <= 7).length > 0);
  let ab = 0; DADOS.casos.forEach(c => (c.pendencias||[]).forEach((_,i) => { if (!estado.pend[c.id+"|"+i]) ab++; }));
  const pp = $("#p-pend"); pp.textContent = ab; pp.classList.toggle("urgente", ab > 10);
  const fp = (estado.fila||[]).filter(x => x.estado === "pendente").length;
  const pf = $("#p-arq"); pf.textContent = fp || ""; pf.classList.toggle("urgente", fp > 0); pf.classList.toggle("oculto", !fp);
}

/* Estado vazio: em vez de mostrar zeros mudos, explica o que fazer. */
function renderAvisoVazio(){
  const box = $("#aviso-vazio"); if (!box) return;
  const vazio = !DADOS.casos.length;
  box.classList.toggle("oculto", !vazio);
  if (!vazio) return;
  if (!MODO_FS){
    box.innerHTML = `<div class="chamada">
      <h3>Os dados não podem ser lidos neste modo</h3>
      <p>O painel foi aberto como arquivo local (<code>file://</code>). Nesse contexto o navegador não deixa
      um site ler pastas do disco. Abra pelo endereço publicado
      <code>https://caiotrombini.github.io/painel-advocacia/</code> e clique em <strong>Carregar do Drive</strong>.</p>
    </div>`;
    return;
  }
  box.innerHTML = `<div class="chamada">
    <h3>Falta um passo: carregar os dados do seu computador</h3>
    <p>Este endereço traz só o programa. Os casos, prazos e agendas ficam no seu Google Drive e
    <strong>nunca são enviados para a internet</strong> — é por isso que o painel começa vazio e precisa da sua autorização.</p>
    <ol>
      <li>Clique no botão abaixo (ou no <strong>Carregar do Drive</strong>, lá no topo)</li>
      <li>Na janela do Windows, selecione a pasta <code>G:\\Meu Drive\\ADVOCACIA</code></li>
      <li>Confirme em <strong>Exibir arquivos</strong> / <strong>Editar arquivos</strong></li>
    </ol>
    <p>O navegador guarda essa permissão. Nas próximas vezes o painel já abre com tudo carregado.</p>
    <button class="btn-principal" id="bt-vazio-carregar">Carregar do Drive agora</button>
  </div>`;
  const b = $("#bt-vazio-carregar");
  if (b) b.addEventListener("click", carregarTudoDoDrive);
}

function renderTudo(){
  renderAvisoVazio();
  renderStatus(); renderKPIs(); renderVencidos(); renderAlertas(); renderTimelines(); renderMiniCasos();
  renderCasos(); renderPendencias(); renderPastas(); renderCalendario();
  renderEscritorio(); renderAcessos(); renderPills(); renderArquivos();
  aplicarBusca();
}
function renderPastas(){ /* lista de pastas vive dentro da aba Arquivos neste layout */ }

/* ==========================================================================
   Interações
   ========================================================================== */
function trocarAba(alvo){
  // Se a aba salva não existe mais (removida numa atualização), volta para o Painel
  if (!alvo || !$("#" + alvo)) alvo = "v-painel";
  $$("nav.abas button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.alvo === alvo)));
  $$(".painel").forEach(p => p.hidden = (p.id !== alvo));
  estado.aba = alvo; salvar();
  window.scrollTo({ top:0, behavior:"smooth" });
}

function aplicarBusca(){
  const q = $("#busca").value.trim().toLowerCase();
  const alvos = $$("[data-busca]");
  if (!q){ alvos.forEach(e => e.classList.remove("oculto")); $("#contador-busca").textContent = ""; return; }
  let n = 0;
  alvos.forEach(e => {
    const ok = semAcento(e.dataset.busca.toLowerCase()).includes(semAcento(q));
    e.classList.toggle("oculto", !ok);
    if (ok) n++;
  });
  $("#contador-busca").textContent = `${n} resultado(s)`;
  $$("details.caso").forEach(d => { if (!d.classList.contains("oculto")) d.open = true; });
}

/* ---------- Zonas de arrastar ---------- */
function ligarZonas(){
  $$(".zona").forEach(z => {
    if (z._ligada) return; z._ligada = true;
    z.addEventListener("dragover", e => { e.preventDefault(); z.classList.add("sobre"); });
    z.addEventListener("dragleave", e => { if (!z.contains(e.relatedTarget)) z.classList.remove("sobre"); });
    z.addEventListener("drop", async e => {
      e.preventDefault(); z.classList.remove("sobre");
      const arquivos = Array.from(e.dataTransfer.files || []);
      if (!arquivos.length){ toast("Nenhum arquivo reconhecido no que foi solto.","alerta"); return; }
      await receberArquivos(arquivos, z.dataset.caso);
    });
  });
}
function escolherArquivos(casoId){
  const inp = document.createElement("input");
  inp.type = "file"; inp.multiple = true;
  inp.addEventListener("change", () => receberArquivos(Array.from(inp.files), casoId));
  inp.click();
}

/* ---------- Cliques globais ---------- */
document.addEventListener("click", e => {
  const t = e.target;
  const conf = t.closest("[data-confirmar]");
  if (conf){ estado.prazos[conf.dataset.confirmar] = true; salvar(); renderTudo(); toast("Prazo marcado como conferido.","ok"); return; }

  const ir = t.closest("[data-ir-caso]");
  if (ir){ trocarAba("v-casos"); abrirCaso(ir.dataset.irCaso); return; }

  const va = t.closest("[data-ver-arquivos]");
  if (va){ casoAberto = va.dataset.verArquivos; trocarAba("v-arq"); renderArquivos(); return; }

  const cp = t.closest("[data-copiar]"); if (cp){ copiarResumo(cp.dataset.copiar); return; }
  const es = t.closest("[data-escolher]"); if (es){ escolherArquivos(es.dataset.escolher); return; }

  const ev = t.closest("[data-ev]");
  if (ev){
    const p = agendaCompleta().find(x => x.chave === ev.dataset.ev);
    if (!p) return;
    if (p.origem === "escritorio"){ trocarAba("v-esc"); abrirFormCompromisso(p.indice); }
    else { trocarAba("v-casos"); abrirCaso(p.caso.id); }
    return;
  }
  const ed = t.closest("[data-edit-comp]"); if (ed){ abrirFormCompromisso(+ed.dataset.editComp); return; }
  const dl = t.closest("[data-del-comp]");
  if (dl){
    const i = +dl.dataset.delComp;
    if (confirm(`Excluir "${estado.compromissos[i].titulo}"?`)){ estado.compromissos.splice(i,1); salvar(); renderTudo(); toast("Compromisso excluído."); }
    return;
  }
  const cd = t.closest("[data-copiar-destino]");
  if (cd){ copiar(estado.fila[+cd.dataset.copiarDestino].destino.replace(/\//g,"\\"), "Caminho copiado — cole no Explorador."); return; }
  const ff = t.closest("[data-feito-fila]");
  if (ff){ estado.fila[+ff.dataset.feitoFila].estado = "arquivado"; salvar(); renderTudo(); return; }
  const df = t.closest("[data-del-fila]");
  if (df){ estado.fila.splice(+df.dataset.delFila,1); salvar(); renderTudo(); return; }
  if (t.closest("#bt-limpar-fila")){ estado.fila = estado.fila.filter(x => x.estado === "pendente"); salvar(); renderTudo(); toast("Fila limpa."); return; }
});
function abrirCaso(id){
  const d = $("#caso-" + id);
  if (d){ d.open = true; setTimeout(() => d.scrollIntoView({ behavior:"smooth", block:"center" }), 120); }
}
function copiar(txt, msg){
  if (navigator.clipboard && window.isSecureContext){
    navigator.clipboard.writeText(txt).then(() => toast(msg,"ok"), () => fallbackCopiar(txt,msg));
  } else fallbackCopiar(txt,msg);
}
function fallbackCopiar(txt,msg){
  const ta = document.createElement("textarea");
  ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); toast(msg,"ok"); } catch(e){ toast("Copie manualmente: " + txt); }
  document.body.removeChild(ta);
}

document.addEventListener("change", e => {
  const c = e.target.closest("[data-pend]");
  if (c){ estado.pend[c.dataset.pend] = c.checked; salvar(); renderKPIs(); renderMiniCasos(); renderPendencias(); renderPills(); aplicarBusca(); return; }
  const a = e.target.closest("[data-acesso-st]");
  if (a){
    const k = a.dataset.acessoSt;
    estado.acessos[k] = Object.assign({ nota:"" }, estado.acessos[k], { st:a.value });
    salvar(); a.className = "sel-" + ST_CLASSE[a.value]; return;
  }
  const nt = e.target.closest("[data-acesso-nota]");
  if (nt){
    const k = nt.dataset.acessoNota;
    estado.acessos[k] = Object.assign({ st:"a_solicitar" }, estado.acessos[k], { nota:nt.value });
    salvar(); return;
  }
});

function copiarResumo(id){
  const c = DADOS.casos.find(x => x.id === id); if (!c) return;
  const pr = todosPrazos().filter(p => p.caso.id === c.id);
  const txt = [
    `${c.cliente} — ${c.titulo}`,
    `Área: ${c.area} | Fase: ${c.fase} | Status: ${c.status}`,
    `Parte contrária: ${c.parteContraria}`,
    `Foro: ${c.foro}${c.valorCausa ? ` | Valor da causa: ${moeda(c.valorCausa)}` : ""}`,
    ``, `FATOS: ${c.resumo||"—"}`, ``, `TESE: ${c.tese||"—"}`, ``,
    `PRAZOS:`, ...pr.map(p => `  - ${fmtData(p.data)} (${fmtRelativo(p.dias)}) ${p.titulo}${p.estimado ? " [ESTIMADO — CONFERIR]" : ""}`),
    ``, `PENDÊNCIAS EM ABERTO:`,
    ...(c.pendencias||[]).map((p,i) => estado.pend[c.id+"|"+i] ? null : `  - [${p.p}] ${p.t}`).filter(Boolean)
  ].join("\n");
  copiar(txt, "Resumo copiado.");
}

/* ---------- Tema ---------- */
function aplicarTema(){
  document.documentElement.dataset.tema = estado.tema;
  $("#btn-tema").innerHTML = estado.tema === "claro"
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
}

/* ---------- Exportar .ics ---------- */
function gerarICS(){
  const pad = n => String(n).padStart(2,"0");
  const carimbo = new Date().toISOString().replace(/[-:]/g,"").split(".")[0] + "Z";
  const L = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Caio Trombini Advocacia//Painel//PT-BR",
             "CALSCALE:GREGORIAN","METHOD:PUBLISH","X-WR-CALNAME:Agenda Jurídica — Caio Trombini"];
  const lim = s => String(s).replace(/\\/g,"\\\\").replace(/,/g,"\\,").replace(/;/g,"\\;").replace(/\n/g,"\\n");
  agendaCompleta().forEach((p,i) => {
    const d = parseData(p.data);
    const ini = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
    const fim = new Date(d); fim.setDate(fim.getDate()+1);
    const fimS = `${fim.getFullYear()}${pad(fim.getMonth()+1)}${pad(fim.getDate())}`;
    const desc = [`Caso: ${p.caso.cliente}`, `Tipo: ${p.tipo||"Compromisso"}`,
                  p.estimado ? "ATENCAO: prazo ESTIMADO automaticamente - confira antes de agir." : "",
                  p.local ? `Local: ${p.local}` : "", p.nota||""].filter(Boolean).join("\n");
    L.push("BEGIN:VEVENT", `UID:ctadv-${p.chave.replace(/\|/g,"-")}-${i}@advocacia`, `DTSTAMP:${carimbo}`);
    if (p.hora && /^\d{2}:\d{2}$/.test(p.hora)){
      const [hh,mm] = p.hora.split(":");
      const f = new Date(d); f.setHours(+hh + 1, +mm);
      L.push(`DTSTART:${ini}T${hh}${mm}00`, `DTEND:${ini}T${pad(f.getHours())}${pad(f.getMinutes())}00`);
    } else {
      L.push(`DTSTART;VALUE=DATE:${ini}`, `DTEND;VALUE=DATE:${fimS}`);
    }
    L.push(`SUMMARY:${lim((p.estimado ? "[ESTIMADO] " : "") + p.titulo + " - " + p.caso.cliente)}`,
      `DESCRIPTION:${lim(desc)}`, `CATEGORIES:${lim(p.tipo||"Compromisso")}`,
      "BEGIN:VALARM","TRIGGER:-P1D","ACTION:DISPLAY",`DESCRIPTION:${lim("E amanha: " + p.titulo)}`,"END:VALARM","END:VEVENT");
  });
  L.push("END:VCALENDAR");
  const dobrar = l => {                       // RFC 5545: máximo 75 octetos por linha
    const enc = new TextEncoder();
    if (enc.encode(l).length <= 75) return l;
    const out = []; let atual = "", bytes = 0;
    for (const ch of l){
      const n = enc.encode(ch).length;
      if (bytes + n > (out.length ? 74 : 75)){ out.push(atual); atual = ""; bytes = 0; }
      atual += ch; bytes += n;
    }
    if (atual) out.push(atual);
    return out.join("\r\n ");
  };
  return L.map(dobrar).join("\r\n") + "\r\n";
}
function baixarBlob(conteudo, tipo, nome){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([conteudo], { type:tipo }));
  a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
function baixarICS(){ baixarBlob(gerarICS(), "text/calendar;charset=utf-8", "Agenda Juridica.ics"); toast("Arquivo .ics gerado — importe no Google Calendar.","ok"); }

/* ---------- Backup dos dados locais ---------- */
function exportarLocal(){
  baixarBlob(JSON.stringify({ compromissos:estado.compromissos, acessos:estado.acessos, pend:estado.pend, prazos:estado.prazos }, null, 2),
    "application/json", "painel-local-" + isoDe(hojeLocal()) + ".json");
  toast("Backup dos seus dados locais baixado.","ok");
}
function importarLocal(){
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json";
  inp.addEventListener("change", async () => {
    try {
      const d = JSON.parse(await inp.files[0].text());
      estado = Object.assign(estado, d); salvar(); renderTudo();
      toast("Backup restaurado.","ok");
    } catch(e){ toast("Arquivo inválido.","erro"); }
  });
  inp.click();
}

/* ---------- Atualizar ---------- */
async function atualizar(){
  const b = $("#btn-refresh"); b.classList.add("girando");
  estado.vistoEm = Date.now(); salvar();
  try {
    if (MODO_FS && !raizHandle) await restaurarPasta();
    else if (MODO_FS && raizHandle) { await carregarDadosDaPasta(); await carregarAgendasDaPasta(); }
    renderTudo();
  }
  finally { setTimeout(() => b.classList.remove("girando"), 600); }
  toast("Painel atualizado.","ok");
}

/* ---------- Atalhos ---------- */
document.addEventListener("keydown", e => {
  if (e.target.matches("input,textarea,select")){
    if (e.key === "Escape" && e.target.id === "busca"){ e.target.value = ""; aplicarBusca(); e.target.blur(); }
    return;
  }
  if ($("#dlg-comp").open || $("#dlg-reclass").open) return;
  if (e.key === "/"){ e.preventDefault(); $("#busca").focus(); return; }
  if (e.key.toLowerCase() === "n"){ e.preventDefault(); trocarAba("v-esc"); abrirFormCompromisso(null); return; }
  if (e.key.toLowerCase() === "r"){ e.preventDefault(); atualizar(); return; }
  const abas = ["v-painel","v-casos","v-agenda","v-esc","v-pend","v-arq"];
  if (/^[1-6]$/.test(e.key)) trocarAba(abas[+e.key - 1]);
});

/* ---------- Início ---------- */
function iniciar(){
  $$("nav.abas button").forEach(b => b.addEventListener("click", () => trocarAba(b.dataset.alvo)));
  $("#busca").addEventListener("input", aplicarBusca);
  $("#btn-tema").addEventListener("click", () => { estado.tema = estado.tema === "claro" ? "escuro" : "claro"; salvar(); aplicarTema(); });
  $("#btn-print").addEventListener("click", () => window.print());
  $("#btn-ics").addEventListener("click", baixarICS);
  $("#btn-refresh").addEventListener("click", atualizar);
  $("#btn-carregar-drive").addEventListener("click", carregarTudoDoDrive);
  $("#btn-exportar").addEventListener("click", exportarLocal);
  $("#btn-importar").addEventListener("click", importarLocal);
  $("#cal-ant").addEventListener("click", () => { calRef.setMonth(calRef.getMonth()-1); renderCalendario(); });
  $("#cal-prox").addEventListener("click", () => { calRef.setMonth(calRef.getMonth()+1); renderCalendario(); });
  $("#cal-hoje").addEventListener("click", () => { const h = hojeLocal(); calRef = new Date(h.getFullYear(), h.getMonth(), 1); renderCalendario(); });
  $("#cale-ant").addEventListener("click", () => { calEscRef.setMonth(calEscRef.getMonth()-1); renderCalEscritorio(); });
  $("#cale-prox").addEventListener("click", () => { calEscRef.setMonth(calEscRef.getMonth()+1); renderCalEscritorio(); });
  $("#cale-hoje").addEventListener("click", () => { const h = hojeLocal(); calEscRef = new Date(h.getFullYear(), h.getMonth(), 1); renderCalEscritorio(); });
  $("#bt-novo-comp").addEventListener("click", () => abrirFormCompromisso(null));
  $("#bt-reclass").addEventListener("click", reclassificarAgenda);
  $("#rc-aplicar").addEventListener("click", aplicarReclassificacao);
  $("#rc-cancelar").addEventListener("click", () => $("#dlg-reclass").close());
  $("#form-comp").addEventListener("submit", salvarCompromisso);
  $("#f-cancelar").addEventListener("click", () => $("#dlg-comp").close());
  $("#f-tipo").innerHTML = TIPOS_COMPROMISSO.map(t => `<option>${t}</option>`).join("");
  ["#f-titulo","#f-pessoa","#f-nota"].forEach(s => $(s).addEventListener("input", avaliarSugestao));
  $("#f-caso").addEventListener("change", () => $("#f-sugestao").classList.add("oculto"));
  $("#btn-carregar-drive").classList.toggle("oculto", !MODO_FS);
  $("#ck-ordem-risco").checked = !!estado.ordemRisco;
  $("#ck-ordem-risco").addEventListener("change", e => { estado.ordemRisco = e.target.checked; salvar(); renderTudo(); });
  $("#bt-hoje-md").addEventListener("click", gerarResumoDia);
  $("#bt-auditar-pastas").addEventListener("click", auditarDivergencias);
  $("#bt-novo-caso").addEventListener("click", () => { $("#nc-aviso").classList.add("oculto"); delete $("#form-novo-caso").dataset.confirmar; $("#dlg-novo-caso").showModal(); });
  $("#nc-cancelar").addEventListener("click", () => $("#dlg-novo-caso").close());
  $("#form-novo-caso").addEventListener("submit", ev => {
    ev.preventDefault();
    const cliente = $("#nc-cliente").value.trim(), area = $("#nc-area").value.trim();
    if (!cliente || !area) return;
    criarNovoCaso(cliente, area, $("#form-novo-caso").dataset.confirmar === "1");
  });
  document.addEventListener("click", e => {
    const btn = e.target.closest("[data-desfecho-salvar]");
    if (btn) registrarDesfechoVencido(btn.dataset.desfechoSalvar);
  });

  // M08: valida o dados.js embutido (modo file:// ou publicado sem pasta conectada)
  // antes de qualquer render — se estiver quebrado, mostra o motivo em vez de tela em branco.
  if (window.DADOS) aplicarDadosValidados(window.DADOS);

  aplicarTema();
  renderTudo();
  trocarAba(estado.aba || "v-painel");
  restaurarPasta();
  setInterval(renderStatus, 60000);
}
document.addEventListener("DOMContentLoaded", iniciar);
