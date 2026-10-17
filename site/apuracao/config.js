// Configuração da projeção da apuração — nada disso fica espalhado nos componentes visuais.
export const CONFIG = {
  titulo: "Apuração do 2º turno de 2026",
  inicio: "2026-10-25T17:00:00-03:00", // começo da divulgação (Brasília)
  fusoNome: "America/Sao_Paulo",
  proxy: "/tse", // proxy com cache (Worker em produção; scripts/serve.mjs no dev) — o TSE não libera CORS
  intervaloMs: 60000, // atualização ao vivo (o TSE publica com max-age=27s; ficamos bem acima)
  maxParalelo: 6,
  // eleições do TSE (códigos de eleição do ciclo 2026). turno 2 só existe a partir de 25/10 — formato a confirmar (ver CLAUDE.md)
  ele: { 1: "6257", 2: "6258" },
  cargo: "c0001", // presidente
  // candidatos do par: A e B (regex sobre o nome de urna que o TSE publica)
  A: { id: "flavio", nome: "Flávio Bolsonaro", curto: "Flávio", partido: "PL", cor: "#1F4F9E", re: /FL[AÁ]VIO/i },
  B: { id: "lula", nome: "Lula", curto: "Lula", partido: "PT", cor: "#E13037", re: /^LULA$/i },
  ufs: "ac al am ap ba ce df es go ma mg ms mt pa pb pe pi pr rj rn ro rr rs sc se sp to zz".split(" "),
  dados: {
    mun1t: "apuracao/dados/mun-1t-2026.json",
    mun2022: "apuracao/dados/mun-2022.json",
    replay: "apuracao/dados/replay-1t-2026.json",
    pesquisa: "data/presidente-2t-flavio.json", // prior fraco
  },
  maxSnapshotsGuardados: 600,
};

// teste local: index.html?inicio=2026-01-01T00:00:00-03:00#apuracao força o modo ao vivo mesmo antes de 25/10 (use com --mock-tse)
try {
  const q = typeof location !== "undefined" ? new URLSearchParams(location.search).get("inicio") : null;
  if (q) CONFIG.inicio = q;
} catch (e) { /* sem location (Node) */ }
