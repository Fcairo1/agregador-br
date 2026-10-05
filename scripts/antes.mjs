// "Antes" da eleição: quem ocupava cada cargo (foto única, commitada em data/antes.json).
// Não é refeito se o arquivo já existe — depois da posse as APIs passam a devolver os NOVOS eleitos.
// Uso: node scripts/antes.mjs [--refresh]
import fs from "node:fs";
import { getPageHTML, tablesWithHeadings, cellText } from "./lib/wiki.mjs";

const OUT = new URL("../data/antes.json", import.meta.url);
if (fs.existsSync(OUT) && !process.argv.includes("--refresh")) {
  console.log("antes.json já existe — mantendo (use --refresh pra refazer)");
  process.exit(0);
}
const H = { "User-Agent": "agregador-br (github.com/Fcairo1/agregador-br)", Accept: "application/json" };
const getJSON = async (url) => {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: H });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) {
      if (i === 2) throw e;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
};

// ---- Câmara: em exercício (composição) + todos da 57ª legislatura (quem "já era deputado") ----
async function camara(params) {
  const out = [];
  for (let page = 1; ; page++) {
    const j = await getJSON(`https://dadosabertos.camara.leg.br/api/v2/deputados?${params}&itens=100&pagina=${page}`);
    out.push(...j.dados);
    if (j.dados.length < 100) break;
  }
  return out.map((d) => ({ id: d.id, name: d.nome, party: d.siglaPartido, uf: d.siglaUf }));
}
// nome civil de cada deputado (a lista só traz o nome parlamentar, que nem sempre é o nome de urna)
async function comNomeCivil(list) {
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const d = list[i++];
      try {
        d.full = (await getJSON(`https://dadosabertos.camara.leg.br/api/v2/deputados/${d.id}`)).dados.nomeCivil || "";
      } catch {
        d.full = "";
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return list;
}

// ---- Senado ----
async function senado() {
  const atual = (await getJSON("https://legis.senado.leg.br/dadosabertos/senador/lista/atual")).ListaParlamentarEmExercicio.Parlamentares.Parlamentar;
  const leg = (await getJSON("https://legis.senado.leg.br/dadosabertos/senador/lista/legislatura/57")).ListaParlamentarLegislatura.Parlamentares.Parlamentar;
  const cur = atual.map((s) => ({
    id: s.IdentificacaoParlamentar.CodigoParlamentar,
    name: s.IdentificacaoParlamentar.NomeParlamentar,
    full: s.IdentificacaoParlamentar.NomeCompletoParlamentar,
    party: s.IdentificacaoParlamentar.SiglaPartidoParlamentar,
    uf: s.IdentificacaoParlamentar.UfParlamentar,
    continues: s.Mandato?.SegundaLegislaturaDoMandato?.NumeroLegislatura === "58", // mandato até 2031 -> não está em disputa em 2026
  }));
  const ever = leg.map((s) => ({ name: s.IdentificacaoParlamentar.NomeParlamentar, full: s.IdentificacaoParlamentar.NomeCompletoParlamentar, uf: s.IdentificacaoParlamentar.UfParlamentar }));
  return { current: cur, ever };
}

// ---- Governadores atuais e deputados da Alesp (Wikipédia) ----
const rowsOf = (html) => [...html.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((m) => [...m[0].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => cellText(c[1])));
async function governadores() {
  const { tables } = tablesWithHeadings(await getPageHTML("Lista de governadores das unidades federativas do Brasil"));
  const t = tables.find((t) => t.path.includes("Atuais governadores"));
  const out = [];
  for (const r of rowsOf(t.html)) {
    if (!/\(lista\)/.test(r[0] || "")) continue; // pula cabeçalho e linhas de mandato-tampão
    const uf = r[0].replace(/\s*\(lista\)/i, "").trim();
    const name = (r[2] || "").replace(/\s*\(interino\)/i, "").trim();
    const pt = r[4] || "";
    const party = /sem partido/i.test(pt) ? "" : pt.trim().split(/\s+/).pop();
    out.push({ uf, name, party, interino: /interino/i.test(r[2] || "") });
  }
  return out;
}
async function alesp() {
  const { tables } = tablesWithHeadings(await getPageHTML("Lista de deputados estaduais de São Paulo da 20.ª legislatura"));
  const out = [];
  const seats = {};
  for (const t of tables.filter((t) => t.path[0] === "Deputados" && t.path.length >= 2)) {
    const party = t.path[t.path.length - 1];
    const m = (rowsOf(t.html)[0]?.[0] || "").match(/\((\d+)\)\s*$/); // "Partido dos Trabalhadores (17)" = cadeiras atuais
    if (m) seats[party] = +m[1];
    let inTit = false;
    for (const r of rowsOf(t.html)) {
      const nz = r.filter(Boolean);
      if (/^Imagem$/.test(nz[0] || "")) { inTit = true; continue; }
      if (nz.length === 1) { inTit = false; continue; } // "Perda de Mandato", "Suplentes"…
      if (inTit && nz.length >= 2) out.push({ name: nz[0], party });
    }
  }
  return { members: out, seats };
}

const antes = {
  fetchedAt: new Date().toISOString(),
  note: "Foto de quem ocupava os cargos antes da eleição de 2026. Câmara/Senado: APIs oficiais; governadores/Alesp: Wikipédia (composição por partido da eleição, sem trocas posteriores).",
  camara: await (async () => {
    const ever = await comNomeCivil(await camara("idLegislatura=57"));
    const current = await camara("");
    const civil = new Map(ever.map((d) => [d.id, d.full]));
    for (const d of current) d.full = civil.get(d.id) || "";
    return { current, ever };
  })(),
  senado: await senado(),
  governadores: await governadores(),
  alesp: await alesp(),
};
console.log(`câmara ${antes.camara.current.length} em exercício / ${antes.camara.ever.length} na legislatura · senado ${antes.senado.current.length} (${antes.senado.current.filter((s) => !s.continues).length} em disputa) · governadores ${antes.governadores.length} · alesp ${antes.alesp.members.length} nomes / ${Object.values(antes.alesp.seats).reduce((a, b) => a + b, 0)} cadeiras`);
fs.writeFileSync(OUT, JSON.stringify(antes) + "\n");
