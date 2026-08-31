// Configuração de cada corrida. Fonte de verdade: CLAUDE.md.

export const RACES = {
  presidente: {
    label: "Presidente",
    wikiPage: "Pesquisas de opinião para a eleição presidencial no Brasil em 2026",
    // Seções-alvo: 1º turno / 2026 / tabelas mensais.  number como "1.1.3".
    sectionRule: (num) => /^1\.1\.\d+$/.test(num),
    year: 2026,
    // Candidatos em destaque (ordem = z-order/legenda). Resto entra como "Outros".
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
  },

  "sp-governador": {
    label: "Governador de SP",
    wikiPage: "Pesquisas eleitorais para a eleição estadual de 2026 em São Paulo",
    // Seções-alvo: "Primeiro Turno (Governador)" / 2026 / tabelas mensais.
    sectionRule: (num) => /^2\.1\.\d+$/.test(num),
    year: 2026,
    display: [
      { key: "tarcisio", name: "Tarcísio", party: "REP", color: "#1E63C4" },
      { key: "haddad", name: "Haddad", party: "PT", color: "#D62B3A" },
      { key: "marcio-franca", name: "Márcio França", party: "PSB", color: "#F28C1E", aliases: ["franca", "marcio"] },
      { key: "kassab", name: "Kassab", party: "PSD", color: "#00A6A6" },
      { key: "boulos", name: "Boulos", party: "PSOL", color: "#7B4BC9" },
      { key: "tabata", name: "Tabata", party: "PSB", color: "#6E8B3D", aliases: ["tabata-amaral"] },
    ],
  },
};

// Um candidato só entra no gráfico se tiver pelo menos isto:
export const PLOT_MIN_POLLS = 6; // total, no período todo
export const PLOT_MIN_RECENT = 5; // nas últimas ~11 semanas (senão a tendência é instável)
export const PLOT_MIN_SUPPORT = 4.0; // pico >= 4 p.p. nas pesquisas recentes
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
};

// Cor de fallback para candidatos fora do "display".
export const FALLBACK_COLORS = [
  "#8C8C8C", "#B0A160", "#6C7A89", "#9B7653", "#5D8AA8", "#A0522D",
];
