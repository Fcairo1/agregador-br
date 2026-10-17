// Configuração de cada corrida. Fonte de verdade: CLAUDE.md.

// ---- cores/rótulos de partido (padroniza as cores dos candidatos) ----
export const PARTY = {
  PT: { label: "PT", color: "#E13037" },
  PL: { label: "PL", color: "#1F4F9E" },
  PSD: { label: "PSD", color: "#00A7A0" },
  NOVO: { label: "NOVO", color: "#F59E1B" },
  "MISSÃO": { label: "MISSÃO", color: "#7C4DD1" },
  Avante: { label: "Avante", color: "#6E8B3D" },
  PRTB: { label: "PRTB", color: "#B8912B" },
  REP: { label: "REP", color: "#2E6BD6" },
  Republicanos: { label: "REP", color: "#2E6BD6" },
  PSB: { label: "PSB", color: "#E8541E" },
  PSOL: { label: "PSOL", color: "#C2185B" },
  PSol: { label: "PSOL", color: "#C2185B" },
  MDB: { label: "MDB", color: "#1B9E5A" },
  PSDB: { label: "PSDB", color: "#0E86C9" },
  PDT: { label: "PDT", color: "#B23A2E" },
  Podemos: { label: "Podemos", color: "#2B7A78" },
  "União": { label: "União", color: "#12508A" },
  "União Brasil": { label: "União", color: "#12508A" },
  PP: { label: "PP", color: "#4A78B5" },
  PCdoB: { label: "PCdoB", color: "#A31D1D" },
  PSTU: { label: "PSTU", color: "#8E1F1F" },
  PCB: { label: "PCB", color: "#7A1414" },
  PCO: { label: "PCO", color: "#611010" },
  UP: { label: "UP", color: "#941B1B" },
  DC: { label: "DC", color: "#3F7E44" },
  PV: { label: "PV", color: "#2E9E5B" },
  PSL: { label: "PSL", color: "#1F4F9E" },
  REDE: { label: "REDE", color: "#2E9E5B" },
  "UNIÃO": { label: "UNIÃO", color: "#12508A" },
  UNIAO: { label: "UNIÃO", color: "#12508A" },
  PODE: { label: "PODE", color: "#2B7A78" },
  PPS: { label: "PPS", color: "#E24A8D" },
};
export function partyInfo(p) {
  if (!p) return null;
  return PARTY[p] || PARTY[String(p).toUpperCase()] || null;
}

// ---- regras por BREADCRUMB de títulos (h2 > h3 > h4). path = ["Primeiro turno","2026","Agosto"]
// Robusto a transclusão de templates (os índices de seção viram "T-1" e quebram o fetch por seção).
const yr = "2026";
const has = (p, i, rx) => rx.test(p[i] || "");
// presidencial 1º turno: h2 "Primeiro turno" > h3 "2026" > (h4 mês, opcional)
const presFirstRound = (p) => /^primeiro turno$/i.test(p[0] || "") && p[1] === yr;
// governador 1º turno: h2 "Primeiro Turno (Governador)" > "2026"
const govFirstRound = (p) => has(p, 0, /primeiro turno/i) && has(p, 0, /governador/i) && p.includes(yr);
// governador 2º turno: h2 "Segundo Turno (Governador)" > 1º confronto (h3) > "2026"
const govSecondRound = (p, ctx) =>
  has(p, 0, /segundo turno/i) && has(p, 0, /governador/i) && ctx.firstSub && p.includes(yr);
// senador: h2 "Senador" > "2026"
const senado = (p) => has(p, 0, /^senador/i) && p.includes(yr);
// 2º turno presidencial: h2 "Segundo turno" > h3 "Lula e <fulano>" > h4 "2026"
const lulaVs = (rx) => (p) =>
  has(p, 0, /segundo turno/i) && has(p, 1, /^lula e /i) && rx.test(p[1] || "") && p.includes(yr);
// SP 2º turno gov: h2 "Segundo Turno" (SEM "(Governador)" nesse artigo) > h3 "Tarcísio e Haddad"
const spRunoff = (p) =>
  has(p, 0, /segundo turno/i) && has(p, 1, /tarc[ií]sio/i) && has(p, 1, /haddad/i) && p.includes(yr);

const PRES_PAGE = "Pesquisas de opinião para a eleição presidencial no Brasil em 2026";
const wikiUrl = (page) => "https://pt.wikipedia.org/wiki/" + encodeURIComponent(page.replace(/ /g, "_"));

// Erro sistemático do setor (p.p., escala crua da pesquisa) — soma em quadratura na faixa.
// Calibrado com o 1º turno de 2026 (04/10): presidente ~1,1 (a faixa de 90% cobriu 83%); estaduais o erro foi bem
// maior (erro quadrático médio ~5,3 p.p. normalizado ≈ 4,2 cru; cobertura de 90% exigiria ~4). Uso 3,8 (encolhido
// pro prior, pois é UMA eleição). Reavaliar depois do 2º turno.
export const SYS_HALF = { presidente: 1.1, estadual: 3.8 };
function race(cfg) {
  const sysHalf = cfg.sysHalf ?? (cfg.wikiPage === PRES_PAGE ? SYS_HALF.presidente : SYS_HALF.estadual);
  return { year: 2026, round: "1T", display: [], sysHalf, ...cfg, wikiUrl: wikiUrl(cfg.wikiPage) };
}
// candidato de destaque: cor vem do partido, salvo override explícito
const C = (key, name, party, extra = {}) => ({ key, name, party, ...extra });

const LULA = C("lula", "Lula", "PT");
const runoff = (oppKey, oppName, oppParty, pathRule, scenario) =>
  race({
    group: "Presidente",
    round: "2T",
    scenario,
    label: `Presidente 2º turno — Lula × ${oppName}`,
    wikiPage: PRES_PAGE,
    pathRule,
    display: [LULA, C(oppKey, oppName, oppParty)],
  });

export const RACES = {
  presidente: race({
    group: "Presidente",
    label: "Presidente — 1º turno",
    wikiPage: PRES_PAGE,
    pathRule: presFirstRound,
    display: [
      LULA,
      C("flavio", "Flávio", "PL", { aliases: ["flavio-bolsonaro"] }),
      C("caiado", "Caiado", "PSD"),
      C("renan", "Renan", "MISSÃO", { aliases: ["renan-santos"] }),
      C("zema", "Zema", "NOVO"),
      C("marcal", "Marçal", "PRTB"),
      C("cury", "Cury", "Avante"),
    ],
  }),

  "presidente-2t-flavio": runoff("flavio", "Flávio", "PL", lulaVs(/fl[aá]vio/i), "Flávio"),
  "presidente-2t-zema": runoff("zema", "Zema", "NOVO", lulaVs(/zema/i), "Zema"),
  "presidente-2t-caiado": runoff("caiado", "Caiado", "PSD", lulaVs(/caiado/i), "Caiado"),
  "presidente-2t-renan": runoff("renan", "Renan", "MISSÃO", lulaVs(/renan/i), "Renan"),

  "sp-governador": race({
    group: "São Paulo",
    label: "Governador de SP — 1º turno",
    wikiPage: "Pesquisas eleitorais para a eleição estadual de 2026 em São Paulo",
    pathRule: govFirstRound,
    display: [
      C("tarcisio", "Tarcísio", "REP"),
      C("haddad", "Haddad", "PT"),
      C("marcio-franca", "Márcio França", "PSB", { aliases: ["franca"] }),
      C("kassab", "Kassab", "PSD"),
      C("boulos", "Boulos", "PSOL"),
    ],
  }),

  "sp-governador-2t": race({
    group: "São Paulo",
    round: "2T",
    scenario: "Haddad",
    label: "Governador de SP 2º turno — Tarcísio × Haddad",
    wikiPage: "Pesquisas eleitorais para a eleição estadual de 2026 em São Paulo",
    pathRule: spRunoff,
    optional: true,
    display: [C("tarcisio", "Tarcísio", "REP"), C("haddad", "Haddad", "PT")],
  }),

  ...stateRaces("mg", "MG", "Minas Gerais", "em Minas Gerais", [C("cleitinho", "Cleitinho", "PSD")]),
  ...stateRaces("rj", "RJ", "Rio de Janeiro", "no Rio de Janeiro"),
  ...stateRaces("pr", "PR", "Paraná", "no Paraná"),
  ...stateRaces("rs", "RS", "Rio Grande do Sul", "no Rio Grande do Sul"),

  // SP já tem gov 1T/2T acima; falta o Senado
  "sp-senado": race({
    group: "São Paulo",
    round: "SEN",
    label: "Senado — São Paulo",
    wikiPage: "Pesquisas eleitorais para a eleição estadual de 2026 em São Paulo",
    pathRule: senado,
    optional: true,
  }),
};

// gera gov 1º turno + gov 2º turno + Senado de um estado
function stateRaces(slug, uf, group, suffix, display = []) {
  const page = `Pesquisas eleitorais para a eleição estadual de 2026 ${suffix}`;
  return {
    [`${slug}-governador`]: race({
      group,
      label: `Governador ${uf} — 1º turno`,
      wikiPage: page,
      pathRule: govFirstRound,
      display,
    }),
    [`${slug}-governador-2t`]: race({
      group,
      round: "2T",
      label: `Governador ${uf} — 2º turno`,
      wikiPage: page,
      pathRule: govSecondRound,
      optional: true,
    }),
    [`${slug}-senado`]: race({
      group,
      round: "SEN",
      label: `Senado — ${group}`,
      wikiPage: page,
      pathRule: senado,
      optional: true,
    }),
  };
}

// ---- presidenciais passadas (só pesquisas de presidente; dados estáticos em data/polls.presidente-<ano>*.csv) ----
// Extraídas UMA vez por scripts/historico.mjs (não rodam no cron). Sem rating/viés de instituto de 2018/22 (seria vazamento do resultado).
// 2002/2006/2010: arquivo de pesquisas do jornalista Fernando Rodrigues (UOL, via Wayback Machine); 2010-2022 também pela Wikipédia.
const BLUE = "#2B64C4";
const HIST = {
  2010: { day1: "2010-10-03", day2: "2010-10-31", page: 2010, f: [C("dilma", "Dilma", "PT"), C("serra", "Serra", "PSDB", { color: BLUE }), C("marina", "Marina", "PV")], s: [C("dilma", "Dilma", "PT"), C("serra", "Serra", "PSDB", { color: BLUE })] },
  2006: { day1: "2006-10-01", day2: "2006-10-29", page: 2006, f: [C("lula", "Lula", "PT"), C("alckmin", "Alckmin", "PSDB", { color: BLUE }), C("heloisa", "Heloísa Helena", "PSOL")], s: [C("lula", "Lula", "PT"), C("alckmin", "Alckmin", "PSDB", { color: BLUE })] },
  2002: { day1: "2002-10-06", day2: "2002-10-27", page: 2002, f: [C("lula", "Lula", "PT"), C("serra", "Serra", "PSDB", { color: BLUE }), C("garotinho", "Garotinho", "PSB"), C("ciro", "Ciro", "PPS", { color: "#F2A33A" })], s: [C("lula", "Lula", "PT"), C("serra", "Serra", "PSDB", { color: BLUE })] },
  2022: { day1: "2022-10-02", day2: "2022-10-30", page: 2022, f: [C("lula", "Lula", "PT"), C("bolsonaro", "Bolsonaro", "PL"), C("ciro", "Ciro", "PDT", { color: "#F2A33A" }), C("tebet", "Tebet", "MDB")], s: [C("lula", "Lula", "PT"), C("bolsonaro", "Bolsonaro", "PL")] },
  2018: { day1: "2018-10-07", day2: "2018-10-28", page: 2018, f: [C("bolsonaro", "Bolsonaro", "PSL"), C("haddad", "Haddad", "PT"), C("ciro", "Ciro", "PDT", { color: "#F2A33A" }), C("alckmin", "Alckmin", "PSDB"), C("marina", "Marina", "REDE")], s: [C("haddad", "Haddad", "PT"), C("bolsonaro", "Bolsonaro", "PSL")] },
  2014: { day1: "2014-10-05", day2: "2014-10-26", page: 2014, f: [C("dilma", "Dilma", "PT"), C("aecio", "Aécio", "PSDB", { color: BLUE }), C("marina", "Marina", "PSB", { color: "#2E9E5B" })], s: [C("dilma", "Dilma", "PT"), C("aecio", "Aécio", "PSDB", { color: BLUE })] },
};
export const HIST_YEARS = Object.keys(HIST).map(Number).sort((a, b) => b - a);
for (const [y, h] of Object.entries(HIST)) {
  const base = { group: "Presidente", year: +y, historic: +y, noRatings: true, sysHalf: SYS_HALF.presidente, wikiPage: PRES_PAGE.replace("2026", y), pathRule: () => false };
  // 2014: Campos (PSB) morreu em 13/ago e Marina assumiu a vaga — a coluna "marina" junta os dois; o modelo roda separado nas duas fases
  RACES[`presidente-${y}`] = race({ ...base, label: `Presidente ${y} — 1º turno`, display: h.f, electionDay: h.day1, ...(+y === 2014 ? { splits: { marina: "2014-08-14" } } : {}) });
  RACES[`presidente-${y}-2t`] = race({ ...base, round: "2T", label: `Presidente ${y} — 2º turno`, display: h.s, electionDay: h.day2 });
}

// Um candidato só entra no gráfico se tiver pelo menos isto:
export const PLOT_MIN_POLLS = 6;
export const PLOT_MIN_RECENT = 5;
export const PLOT_MIN_SUPPORT = 4.0;
export const PLOT_MAX_LINES = 8;

export const AGG = {
  span: 0.35,
  minPts: 6,
  halflifeDays: 28,
  bootstrap: 200,
  seed: 20260101,
  gridStepDays: 2,
  bandLo: 10,
  bandHi: 90,
  houseMaxShift: 4,
  sparseCutoff: 25, // < isto = corrida "esparsa" (janela mais larga)
};

export const FALLBACK_COLORS = [
  "#6C7A89", "#B0A160", "#9B7653", "#5D8AA8", "#A0522D", "#7E8AA2", "#8C8C8C",
];
