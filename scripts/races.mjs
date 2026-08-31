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
};
export function partyInfo(p) {
  if (!p) return null;
  return PARTY[p] || PARTY[String(p).toUpperCase()] || null;
}

// ---- regras de seção (numeração dos artigos da Wikipédia) ----
const presFirstRound = (s) => /^1\.1\.\d+$/.test(s.number);
const govFirstRound = (s) => /^2\.1\.\d+$/.test(s.number);
const exact = (want) => (s) => s.number === want;
// 2º turno presidencial: seções "202X" sob um pai "Lula e <fulano>"
const lulaVs = (rx) => (s, all) => {
  if (!/^2\.\d+\.\d+$/.test(s.number) || !/2026/.test(s.line)) return false;
  const parent = all.find((p) => p.number === s.number.replace(/\.\d+$/, ""));
  return !!parent && /^lula e /i.test(parent.line) && rx.test(parent.line);
};

const PRES_PAGE = "Pesquisas de opinião para a eleição presidencial no Brasil em 2026";
const wikiUrl = (page) => "https://pt.wikipedia.org/wiki/" + encodeURIComponent(page.replace(/ /g, "_"));

function race(cfg) {
  return { year: 2026, round: "1T", display: [], ...cfg, wikiUrl: wikiUrl(cfg.wikiPage) };
}
// candidato de destaque: cor vem do partido, salvo override explícito
const C = (key, name, party, extra = {}) => ({ key, name, party, ...extra });

const LULA = C("lula", "Lula", "PT");
const runoff = (oppKey, oppName, oppParty, sectionRule, scenario) =>
  race({
    group: "Presidente",
    round: "2T",
    scenario,
    label: `Presidente 2º turno — Lula × ${oppName}`,
    wikiPage: PRES_PAGE,
    sectionRule,
    display: [LULA, C(oppKey, oppName, oppParty)],
  });

export const RACES = {
  presidente: race({
    group: "Presidente",
    label: "Presidente — 1º turno",
    wikiPage: PRES_PAGE,
    sectionRule: presFirstRound,
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
    sectionRule: govFirstRound,
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
    sectionRule: exact("3.1.1"),
    display: [C("tarcisio", "Tarcísio", "REP"), C("haddad", "Haddad", "PT")],
  }),

  "mg-governador": race({
    group: "Minas Gerais",
    label: "Governador de MG",
    wikiPage: "Pesquisas eleitorais para a eleição estadual de 2026 em Minas Gerais",
    sectionRule: govFirstRound,
  }),
  "rj-governador": race({
    group: "Rio de Janeiro",
    label: "Governador do RJ",
    wikiPage: "Pesquisas eleitorais para a eleição estadual de 2026 no Rio de Janeiro",
    sectionRule: govFirstRound,
  }),
  "pr-governador": race({
    group: "Paraná",
    label: "Governador do PR",
    wikiPage: "Pesquisas eleitorais para a eleição estadual de 2026 no Paraná",
    sectionRule: govFirstRound,
  }),
  "rs-governador": race({
    group: "Rio Grande do Sul",
    label: "Governador do RS",
    wikiPage: "Pesquisas eleitorais para a eleição estadual de 2026 no Rio Grande do Sul",
    sectionRule: govFirstRound,
  }),
};

// Um candidato só entra no gráfico se tiver pelo menos isto:
export const PLOT_MIN_POLLS = 6;
export const PLOT_MIN_RECENT = 5;
export const PLOT_MIN_SUPPORT = 4.0;
export const PLOT_MAX_LINES = 7;

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
