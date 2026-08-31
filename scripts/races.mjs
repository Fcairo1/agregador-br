// Configuração de cada corrida. Fonte de verdade: CLAUDE.md.

// Regras de seção reutilizáveis (baseadas na numeração dos artigos da Wikipédia):
const presFirstRound = (n) => /^1\.1\.\d+$/.test(n); // "Primeiro turno" > 2026 > meses
const govFirstRound = (n) => /^2\.1\.\d+$/.test(n); // "Primeiro Turno (Governador)" > 2026 > meses
const exact = (want) => (n) => n === want;

const wikiUrl = (page) =>
  "https://pt.wikipedia.org/wiki/" + encodeURIComponent(page.replace(/ /g, "_"));

function race(cfg) {
  return { year: 2026, round: "1T", display: [], ...cfg, wikiUrl: wikiUrl(cfg.wikiPage) };
}

export const RACES = {
  presidente: race({
    group: "Presidente",
    label: "Presidente — 1º turno",
    wikiPage: "Pesquisas de opinião para a eleição presidencial no Brasil em 2026",
    sectionRule: presFirstRound,
    // key = slug do nome curto exibido na Wikipédia. aliases = outros slugs aceitos.
    display: [
      { key: "lula", name: "Lula", party: "PT", color: "#D62B3A" },
      { key: "flavio", name: "Flávio", party: "PL", color: "#1E63C4", aliases: ["flavio-bolsonaro"] },
      { key: "caiado", name: "Caiado", party: "PSD", color: "#00A6A6" },
      { key: "renan", name: "Renan", party: "MISSÃO", color: "#7B4BC9", aliases: ["renan-santos"] },
      { key: "zema", name: "Zema", party: "NOVO", color: "#F28C1E" },
      { key: "marcal", name: "Marçal", party: "PRTB", color: "#E0669A" },
      { key: "cury", name: "Cury", party: "Avante", color: "#6E8B3D" },
    ],
  }),

  "presidente-2t": race({
    group: "Presidente",
    label: "Presidente — 2º turno",
    round: "2T",
    wikiPage: "Pesquisas de opinião para a eleição presidencial no Brasil em 2026",
    sectionRule: exact("2.1.1"), // "Segundo turno" > "Lula e Flávio Bolsonaro" > 2026
    display: [
      { key: "lula", name: "Lula", party: "PT", color: "#D62B3A" },
      { key: "flavio", name: "Flávio", party: "PL", color: "#1E63C4", aliases: ["flavio-bolsonaro"] },
    ],
  }),

  "sp-governador": race({
    group: "São Paulo",
    label: "Governador de SP — 1º turno",
    wikiPage: "Pesquisas eleitorais para a eleição estadual de 2026 em São Paulo",
    sectionRule: govFirstRound,
    display: [
      { key: "tarcisio", name: "Tarcísio", party: "REP", color: "#1E63C4" },
      { key: "haddad", name: "Haddad", party: "PT", color: "#D62B3A" },
      { key: "marcio-franca", name: "Márcio França", party: "PSB", color: "#F28C1E", aliases: ["franca"] },
      { key: "kassab", name: "Kassab", party: "PSD", color: "#00A6A6" },
      { key: "boulos", name: "Boulos", party: "PSOL", color: "#7B4BC9" },
    ],
  }),

  "sp-governador-2t": race({
    group: "São Paulo",
    label: "Governador de SP — 2º turno",
    round: "2T",
    wikiPage: "Pesquisas eleitorais para a eleição estadual de 2026 em São Paulo",
    sectionRule: exact("3.1.1"), // "Segundo Turno" > "Tarcísio e Haddad" > 2026
    display: [
      { key: "tarcisio", name: "Tarcísio", party: "REP", color: "#1E63C4" },
      { key: "haddad", name: "Haddad", party: "PT", color: "#D62B3A" },
    ],
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
export const PLOT_MIN_POLLS = 6; // total, no período todo
export const PLOT_MIN_RECENT = 5; // nas últimas ~11 semanas (senão a tendência é instável)
export const PLOT_MIN_SUPPORT = 4.0; // média recente >= 4 p.p.
export const PLOT_MAX_LINES = 7;

export const AGG = {
  span: 0.35, // fração de pontos na janela do LOESS
  minPts: 6, // mínimo de pontos na janela
  halflifeDays: 28, // meia-vida do peso de recência
  bootstrap: 200, // réplicas
  seed: 20260101, // determinismo
  gridStepDays: 2, // resolução da grade de saída
  bandLo: 10, // percentis da faixa
  bandHi: 90,
  houseMaxShift: 4, // teto (p.p.) do ajuste de "house effect" por instituto
};

// Cor de fallback para candidatos fora do "display".
export const FALLBACK_COLORS = [
  "#D62B3A", "#1E63C4", "#00A6A6", "#F28C1E", "#7B4BC9", "#6E8B3D", "#C2569B", "#8C8C8C",
];
