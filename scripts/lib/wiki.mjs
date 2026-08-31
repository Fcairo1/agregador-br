// Busca e parsing das tabelas de pesquisa da Wikipédia (API MediaWiki).
// Sem dependências. Ver CLAUDE.md para o contrato.

import fs from "node:fs";
import path from "node:path";

const API = "https://pt.wikipedia.org/w/api.php";
const CACHE_DIR = new URL("../../.cache/", import.meta.url);
const UA = "agregador-br/0.1 (https://github.com/; agregador de pesquisas, uso de pesquisa)";

function cachePath(key) {
  return new URL(key.replace(/[^\w.-]/g, "_") + ".json", CACHE_DIR);
}

async function apiGet(params, { offline = false, cacheKey } = {}) {
  const cp = cacheKey ? cachePath(cacheKey) : null;
  if (offline) {
    if (!cp || !fs.existsSync(cp)) throw new Error(`--offline: falta cache ${cacheKey}`);
    return JSON.parse(fs.readFileSync(cp, "utf8"));
  }
  const usp = new URLSearchParams({ format: "json", formatversion: "2", ...params });
  const url = `${API}?${usp}`;
  const res = await fetch(url, { headers: { "user-agent": UA, "accept": "application/json" } });
  if (!res.ok) throw new Error(`MediaWiki ${res.status} para ${params.page || ""} ${params.section || ""}`);
  const json = await res.json();
  if (cp) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cp, JSON.stringify(json));
  }
  return json;
}

export async function getSections(page, opts) {
  const j = await apiGet(
    { action: "parse", page, prop: "sections" },
    { ...opts, cacheKey: `sections__${page}` }
  );
  return j.parse.sections.map((s) => ({ number: String(s.number), index: String(s.index), line: s.line }));
}

export async function getSectionHTML(page, index, opts) {
  const j = await apiGet(
    { action: "parse", page, section: String(index), prop: "text", disablelimitreport: "1" },
    { ...opts, cacheKey: `sec__${page}__${index}` }
  );
  return j.parse.text;
}

export async function getPageWikitext(page, opts) {
  const j = await apiGet(
    { action: "parse", page, prop: "wikitext", disablelimitreport: "1" },
    { ...opts, cacheKey: `wt__${page}` }
  );
  return j.parse.wikitext;
}

// mapa  nome-da-ref -> URL de fonte, a partir do wikitext da página inteira
export function buildRefMap(wikitext) {
  const map = new Map();
  const re = /<ref\b[^>]*\bname\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/ref>/gi;
  let m;
  while ((m = re.exec(wikitext))) {
    if (map.has(m[1])) continue;
    const body = m[2];
    const url =
      body.match(/\burl\s*=\s*(https?:\/\/[^\s|}\]]+)/i)?.[1] ||
      body.match(/\[(https?:\/\/[^\s\]]+)/)?.[1] ||
      body.match(/(https?:\/\/[^\s|}\]]+)/)?.[1];
    if (url) map.set(m[1], url.replace(/[.,;]+$/, ""));
  }
  return map;
}
// extrai o nome da ref citada dentro do HTML de uma célula
function refNameFromCell(html) {
  const m = html.match(/#cite[_%23;a-z0-9]*note-(.+?)-\d+"/i) || html.match(/cite[_%23;a-z0-9]*ref-(.+?)_\d+-\d+"/i);
  return m ? decode(m[1]) : null;
}

// ---------- parsing de HTML (só o suficiente pra tabelas wikitable) ----------

const ENT = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'",
  "&nbsp;": " ", "&#160;": " ", "&thinsp;": " ", "&#8201;": " ",
  "&ndash;": "–", "&#8211;": "–", "&mdash;": "—", "&#8212;": "—", "&minus;": "−",
};
function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&[a-z]+;/gi, (m) => ENT[m.toLowerCase()] ?? m);
}

function cellText(html) {
  return decode(
    html
      .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, "") // notas de rodapé
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/\s+/g, " ")
    .trim();
}

// nome + partido a partir do HTML da célula de cabeçalho do candidato
function candFromHeader(html) {
  // o nome vem antes do primeiro <br> ou "(" — pode ou não estar num <a>
  const head = html.replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, "").split(/<br\s*\/?>/i)[0];
  let name = cellText(head).split("(")[0].trim();
  if (!name || !/[a-zA-ZÀ-ÿ]/.test(name)) {
    const a = html.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i);
    name = a ? cellText(a[1]).split("(")[0].trim() : "";
  }
  name = name.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const flat = cellText(html);
  const party = flat.match(/\(([A-ZÇÃÕ][A-ZÇÃÕ0-9./-]{1,9})\)/)?.[1] || "";
  return { name, party, raw: flat };
}

function splitRows(tableHtml) {
  // conteúdo entre <tr ...> ... até o próximo <tr> ou </table>
  const rows = [];
  const re = /<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/table>|<\/tbody>)/gi;
  let m;
  while ((m = re.exec(tableHtml))) rows.push(m[1]);
  return rows;
}

function splitCells(rowHtml) {
  const cells = [];
  const re = /<(t[hd])\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(rowHtml))) {
    const attrs = m[2] || "";
    const rs = +(attrs.match(/rowspan="?(\d+)"?/i)?.[1] || 1);
    const cs = +(attrs.match(/colspan="?(\d+)"?/i)?.[1] || 1);
    cells.push({ tag: m[1].toLowerCase(), rowspan: rs, colspan: cs, html: m[3] });
  }
  return cells;
}

// resolve rowspan/colspan varrendo linha a linha; devolve grade [linha][col] = célula
function buildGrid(rows) {
  const grid = [];
  const carry = []; // por coluna: { cell, left }
  for (const rowHtml of rows) {
    const cells = splitCells(rowHtml);
    const out = [];
    const fresh = []; // out[c] veio de célula nova nesta linha?
    let c = 0;
    let ci = 0;
    const width = Math.max(
      carry.length,
      cells.reduce((a, x) => a + x.colspan, 0) + carry.filter((x) => x && x.left > 0).length
    );
    while (c < width || ci < cells.length) {
      if (carry[c] && carry[c].left > 0) {
        out[c] = carry[c].cell;
        fresh[c] = false;
        carry[c].left--;
        c++;
        continue;
      }
      const cell = cells[ci++];
      if (!cell) break;
      for (let k = 0; k < cell.colspan; k++) {
        out[c] = cell;
        fresh[c] = k === 0;
        if (cell.rowspan > 1) carry[c] = { cell, left: cell.rowspan - 1 };
        c++;
      }
    }
    grid.push({ cells: out, fresh });
  }
  return grid;
}

const META_RE = /contratante|pesquisa|instituto|data|amostra|margem|erro|cen[aá]?\.?$|cenário/i;
const TRAIL_RE = /outros|indecis|nulo|branco|n[ãa]o sabe|n[ãa]o respond|ns\/?nr|nenhum|n[ãa]o vota|indef|absten|vantagem|diferen[çc]a|^dif\.?$|lidera|empate/i;
const DATEISH = /\d{1,2}\s*(?:de\s+)?(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)/i;

const MONTHS = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };
function deaccent(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}
export function slug(s) {
  return deaccent(String(s)).toLowerCase().replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "");
}

function parseDates(text, fallbackYear) {
  const t = deaccent(text).toLowerCase().replace(/–|—|−/g, "-");
  const yearM = t.match(/\b(20\d{2})\b/);
  const year = yearM ? +yearM[1] : fallbackYear;
  // tokens: dia [mes]
  const toks = [];
  const re = /(\d{1,2})\s*(?:de\s+)?([a-z]{3,})?/g;
  let m;
  while ((m = re.exec(t))) {
    const day = +m[1];
    if (day < 1 || day > 31) continue;
    let mon = null;
    if (m[2]) {
      const k = m[2].slice(0, 3);
      if (k in MONTHS) mon = MONTHS[k];
    }
    toks.push({ day, mon });
  }
  if (!toks.length) return null;
  // último mês conhecido -> fim; começo herda se faltar
  let endTok = toks[toks.length - 1];
  let startTok = toks[0];
  let endMon = endTok.mon;
  for (let i = toks.length - 1; i >= 0 && endMon == null; i--) if (toks[i].mon != null) endMon = toks[i].mon;
  let startMon = startTok.mon;
  for (let i = 0; i < toks.length && startMon == null; i++) if (toks[i].mon != null) startMon = toks[i].mon;
  if (endMon == null) endMon = startMon;
  if (startMon == null) startMon = endMon;
  if (endMon == null) return null;
  let startYear = year;
  let endYear = year;
  if (startMon > endMon) startYear = year - 1; // ex.: dez -> jan
  const iso = (y, mo, d) => {
    const dt = new Date(Date.UTC(y, mo, d));
    if (Number.isNaN(dt.getTime())) return null;
    return dt.toISOString().slice(0, 10);
  };
  const start = iso(startYear, startMon, startTok.day);
  const end = iso(endYear, endMon, endTok.day);
  if (!start || !end) return null;
  return { start, end };
}

function pctToNum(s) {
  if (s == null) return null;
  let t = deaccent(String(s)).toLowerCase().replace(/\s|%|p\.?p\.?|pt|≈|~|\*/g, "");
  t = t.replace(",", ".");
  if (!/\d/.test(t) || /^[-–—−.]+$/.test(t)) return null;
  const m = t.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const v = parseFloat(m[0]);
  return Number.isFinite(v) ? v : null;
}
function intFrom(s) {
  const d = String(s).replace(/[^\d]/g, "");
  return d ? parseInt(d, 10) : null;
}
function floatFrom(s) {
  const m = deaccent(String(s)).replace(",", ".").match(/\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

// normaliza grafias de instituto (a Wiki tem variações e erros de digitação)
const POLLSTER_ALIASES = [
  [/atlas ?in?stel|atlas ?intel|^atlas$/i, "AtlasIntel"],
  [/genial ?\/? ?quaest|^quaest$/i, "Genial/Quaest"],
  [/nexus ?\/? ?btg|^nexus$/i, "Nexus/BTG Pactual"],
  [/^poderdata/i, "PoderData"],
  [/real ?time ?big ?data|^rtbd$/i, "Real Time Big Data"],
  [/paran[aá] pesquisas/i, "Paraná Pesquisas"],
  [/^ipec$|ipespe?c?$/i, "Ipec"],
  [/^datafolha$/i, "Datafolha"],
  [/^cnt ?\/? ?mda$|^mda$/i, "CNT/MDA"],
  [/^vox\b|vox brasil/i, "Vox Brasil"],
  [/^indexa/i, "Indexa"],
  [/^alfa\b/i, "Alfa"],
  [/american analytics/i, "American Analytics"],
  [/meio ?\/? ?ideia/i, "Meio/Ideia"],
  [/apex ?\/? ?futura/i, "Apex/Futura"],
];
export function normPollster(s) {
  const t = String(s).trim().replace(/\s+/g, " ");
  for (const [re, name] of POLLSTER_ALIASES) if (re.test(t)) return name;
  return t;
}

// margem de erro derivada de n (95%, p=0.5): 0.98/sqrt(n) em pontos
export function moeFromN(n) {
  if (!n || n <= 0) return null;
  return Math.round((98 / Math.sqrt(n)) * 10) / 10;
}

// devolve { candidates:[{key,name,party}], polls:[{pollster,start,end,n,moe,source,values:{key:num}}] }
export function parsePollTable(tableHtml, { year, warn = () => {}, refMap = new Map() } = {}) {
  const rows = splitRows(tableHtml);
  if (rows.length < 3) return null;
  const grid = buildGrid(rows);

  const ncols = Math.max(...grid.map((g) => g.cells.length));

  // 1ª linha de dados = a primeira com um padrão de data nas 3 primeiras colunas
  let headEnd = -1;
  for (let i = 0; i < grid.length; i++) {
    const early = grid[i].cells.slice(0, 4).map((c) => (c ? cellText(c.html) : "")).join(" ");
    if (DATEISH.test(early)) {
      headEnd = i;
      break;
    }
  }
  if (headEnd < 1) return null; // tabela sem linhas de dados (ex.: mês futuro)
  // texto agregado de cabeçalho por coluna
  const colHeadText = [];
  for (let c = 0; c < ncols; c++) {
    let parts = [];
    for (let i = 0; i < headEnd; i++) {
      const cell = grid[i].cells[c];
      if (cell) parts.push(cellText(cell.html));
    }
    colHeadText[c] = parts.join(" ").trim();
  }

  // metaCount = colunas iniciais que casam META_RE
  let metaCount = 0;
  while (metaCount < ncols && META_RE.test(colHeadText[metaCount] || "")) metaCount++;
  if (metaCount < 3) metaCount = 3; // fallback: contratante, data, amostra
  // trailing = colunas finais que casam TRAIL_RE
  let trailCount = 0;
  while (
    trailCount < ncols - metaCount &&
    TRAIL_RE.test(colHeadText[ncols - 1 - trailCount] || "")
  )
    trailCount++;

  const candStart = metaCount;
  const candEnd = ncols - trailCount; // exclusivo
  if (candEnd - candStart < 2) {
    warn(`tabela ignorada: colunas de candidato insuficientes (${candStart}..${candEnd})`);
    return null;
  }

  // identidade dos candidatos: última linha de cabeçalho que tenha <a> nessas colunas
  let nameRow = -1;
  for (let i = headEnd - 1; i >= 0; i--) {
    const hasNames = grid[i].cells
      .slice(candStart, candEnd)
      .some((c) => c && /<a\b/i.test(c.html) && !/mw-file/i.test(c.html));
    if (hasNames) {
      nameRow = i;
      break;
    }
  }
  const candidates = [];
  for (let c = candStart; c < candEnd; c++) {
    const headTxt = colHeadText[c] || "";
    if (TRAIL_RE.test(headTxt)) continue; // "Outros"/"Indecisos"/"Nulos" mesmo no meio
    const cell = (nameRow >= 0 && grid[nameRow].cells[c]) || grid[headEnd - 1].cells[c];
    const { name, party } = cell ? candFromHeader(cell.html) : { name: "", party: "" };
    if (!name || !/[a-zA-ZÀ-ÿ]/.test(name)) continue; // coluna espaçadora / sem nome
    candidates.push({ key: slug(name), name, party, col: c });
  }
  if (candidates.length < 2) {
    warn("tabela ignorada: menos de 2 candidatos nomeados");
    return null;
  }

  // qual coluna é qual (dentro do meta). Ordem importa: datas antes de instituto.
  const metaIdx = { pollster: 0, dates: 1, n: 2, moe: 3 };
  for (let c = 0; c < metaCount; c++) {
    const h = deaccent(colHeadText[c] || "").toLowerCase();
    if (/\bdata|datas de/.test(h)) metaIdx.dates = c;
    else if (/amostra/.test(h)) metaIdx.n = c;
    else if (/margem|erro/.test(h)) metaIdx.moe = c;
    else if (/contratante|instituto|respons/.test(h)) metaIdx.pollster = c;
  }
  // se a coluna "instituto" não foi identificada, é a 1ª que não é data/n/moe
  if ([metaIdx.dates, metaIdx.n, metaIdx.moe].includes(metaIdx.pollster)) {
    for (let c = 0; c < metaCount; c++)
      if (![metaIdx.dates, metaIdx.n, metaIdx.moe].includes(c)) {
        metaIdx.pollster = c;
        break;
      }
  }

  const polls = [];
  for (let i = headEnd; i < grid.length; i++) {
    const { cells, fresh } = grid[i];
    if (!cells[metaIdx.pollster]) continue;
    // linha de continuação (cenário 2+): a coluna do instituto veio de rowspan
    if (fresh[metaIdx.pollster] === false) continue;
    const pollster = normPollster(cellText(cells[metaIdx.pollster]?.html || ""));
    if (!pollster || /^\s*$/.test(pollster)) continue;
    // pula linhas de "evento" (2º turno, datas de eleição etc.)
    if (/turno|elei[çc][ãa]o|debate|resultado/i.test(pollster) && cells.length < candEnd) continue;

    const datesTxt = cellText(cells[metaIdx.dates]?.html || "");
    const d = parseDates(datesTxt, year);
    if (!d) {
      warn(`data não parseada: "${datesTxt}" (${pollster})`);
      continue;
    }
    const n = intFrom(cellText(cells[metaIdx.n]?.html || ""));
    let moe = floatFrom(cellText(cells[metaIdx.moe]?.html || ""));
    if (!moe) moe = moeFromN(n);

    const values = {};
    let any = false;
    for (const cand of candidates) {
      const v = pctToNum(cellText(cells[cand.col]?.html || ""));
      if (v != null) {
        values[cand.key] = v;
        any = true;
      }
    }
    if (!any) continue;

    // rejeita linhas-fantasma (linhas de "evento"/nota mal interpretadas como pesquisa)
    if (/^\d{1,2}\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)/i.test(pollster)) continue;
    if (n != null && n < 250) continue; // pesquisa real não tem amostra minúscula
    const vv = Object.values(values);
    if (vv.length >= 4 && vv.every((x) => x === vv[0])) continue; // todos iguais = não é pesquisa

    const refName = refNameFromCell(cells[metaIdx.pollster]?.html || "");
    const source = (refName && refMap.get(refName)) || "";
    polls.push({ pollster, start: d.start, end: d.end, n, moe, source, values });
  }

  return { candidates: candidates.map(({ col, ...c }) => c), polls };
}

// junta todas as seções-alvo de uma corrida
export async function fetchRacePolls(race, opts) {
  const sections = await getSections(race.wikiPage, opts);
  const targets = sections.filter((s) => race.sectionRule(s.number));
  if (!targets.length) throw new Error(`nenhuma seção casou a regra para ${race.wikiPage}`);
  let refMap = new Map();
  try {
    refMap = buildRefMap(await getPageWikitext(race.wikiPage, opts));
  } catch (e) {
    console.warn(`  aviso: não consegui o wikitext para links de fonte (${e.message})`);
  }
  const allPolls = [];
  const candNames = new Map();
  for (const sec of targets) {
    const html = await getSectionHTML(race.wikiPage, sec.index, opts);
    const tables = html.match(/<table\b[^>]*wikitable[^>]*>[\s\S]*?<\/table>/gi) || [];
    for (const tbl of tables) {
      const parsed = parsePollTable(tbl, {
        year: race.year,
        refMap,
        warn: (msg) => console.warn(`  [${sec.line}] ${msg}`),
      });
      if (!parsed) continue;
      for (const c of parsed.candidates) if (c.name) candNames.set(c.key, c);
      for (const p of parsed.polls) allPolls.push({ ...p, section: sec.line });
    }
  }
  return { polls: allPolls, candidates: [...candNames.values()] };
}
