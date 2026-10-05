// Eleitos de 2026 (TSE) + comparativo "antes × depois" -> data/eleitos.json (+ site/data/eleitos.json)
// Escopo (definido com o usuário): gov/senado = todos os estados; dep. federal = Sul+Sudeste; dep. estadual = só SP.
// Roda depois do aggregate; best-effort (qualquer falha = pula, o site fica com o último dado).
import fs from "node:fs";
import { getCargo, CARGO, UFS } from "./lib/tse.mjs";
import { PARTY } from "./races.mjs";

const ROOT = new URL("../", import.meta.url);
const SCOPE_FED = ["sp", "rj", "mg", "es", "pr", "sc", "rs"]; // Sul + Sudeste
const SCOPE_EST = ["sp"];

// ---------- utilidades ----------
const strip = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const STOP = new Set(["de", "da", "do", "dos", "das", "e", "di", "du"]);
const toks = (s) => strip(s).split(" ").filter((t) => t && !STOP.has(t));
// "PC do B" / "PCdoB" / "Republicanos" / "REPUBLICANOS" -> mesma chave
const pkey = (p) => strip(p).replace(/ /g, "");
const PALIAS = { rep: "republicanos", uniao: "uniao", pcdob: "pcdob", podemos: "pode", pode: "pode", patriota: "patri", solidariedade: "solidariedade", sd: "solidariedade" };
const canon = (p) => {
  const k = pkey(p);
  return PALIAS[k] || k;
};
const COLORS = Object.fromEntries(Object.entries(PARTY).map(([k, v]) => [canon(k), v.color]));
const colorOf = (p) => {
  const k = canon(p);
  if (COLORS[k]) return COLORS[k];
  let h = 0;
  for (const c of k) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 38% 48%)`;
};
const inc = (o, k, n = 1) => (o[k] = (o[k] || 0) + n);

// ---------- coleta TSE ----------
async function collect() {
  const R = { governador: {}, senador: {}, federal: {}, estadual: {} };
  const jobs = [];
  for (const uf of UFS) {
    jobs.push(["governador", uf, CARGO.governador], ["senador", uf, CARGO.senador]);
    if (SCOPE_FED.includes(uf)) jobs.push(["federal", uf, CARGO.federal]);
    if (SCOPE_EST.includes(uf)) jobs.push(["estadual", uf, CARGO.estadual]);
  }
  let i = 0;
  const worker = async () => {
    while (i < jobs.length) {
      const [k, uf, cargo] = jobs[i++];
      try {
        R[k][uf] = await getCargo(uf, cargo);
      } catch (e) {
        console.warn(`  ${k}/${uf}: ${e.message}`);
        R[k][uf] = null;
      }
    }
  };
  await Promise.all(Array.from({ length: 5 }, worker));
  R.presidente = await getCargo("br", CARGO.presidente).catch(() => null);
  // 2º turno (25/10): só presidente e governador do RJ são acompanhados. Os arquivos só existem depois da votação.
  R.presidente2 = await getCargo("br", CARGO.presidente, 2).catch(() => null);
  const rj2 = await getCargo("rj", CARGO.governador, 2).catch(() => null);
  if (rj2 && rj2.cands.some((c) => c.status === "Eleito")) R.governador.rj = { ...rj2, turno2: true };
  return R;
}

// ---------- "já ocupava o cargo?" ----------
function makeMatchers(antes) {
  const byUF = (list, key = "uf") => {
    const m = new Map();
    for (const x of list) {
      const k = (x[key] || "").toLowerCase();
      if (!m.has(k)) m.set(k, []);
      m.get(k).push({ ...x, t: toks(x.name), n: strip(x.name), tf: toks(x.full || "") });
    }
    return m;
  };
  const find = (idx, uf, c) => {
    const list = idx.get(uf) || [];
    const urna = strip(c.urna);
    const full = new Set(toks(c.name));
    const jac = (a, b) => {
      const A = new Set(a), B = new Set(b);
      const i = [...A].filter((t) => B.has(t)).length;
      return A.size && B.size ? i / (A.size + B.size - i) : 0;
    };
    // 1) nome civil (TSE `nm` × Câmara/Senado `full`) — o mais confiável; 2) nome de urna idêntico; 3) nome parlamentar ⊂ nome completo
    let hit = list.find((x) => x.tf.length >= 2 && jac(x.tf, [...full]) >= 0.75);
    if (!hit) hit = list.find((x) => x.n === urna);
    if (!hit) hit = list.find((x) => x.t.length >= 2 && x.t.every((t) => full.has(t)));
    return hit || null;
  };
  const camEver = byUF(antes.camara.ever);
  const camCur = new Set(antes.camara.current.map((d) => d.id));
  const senEver = byUF(antes.senado.ever);
  const govAt = new Map(antes.governadores.map((g) => [g.uf, g]));
  const UFNAME = { ac: "Acre", al: "Alagoas", ap: "Amapá", am: "Amazonas", ba: "Bahia", ce: "Ceará", df: "Distrito Federal", es: "Espírito Santo", go: "Goiás", ma: "Maranhão", mt: "Mato Grosso", ms: "Mato Grosso do Sul", mg: "Minas Gerais", pa: "Pará", pb: "Paraíba", pr: "Paraná", pe: "Pernambuco", pi: "Piauí", rj: "Rio de Janeiro", rn: "Rio Grande do Norte", rs: "Rio Grande do Sul", ro: "Rondônia", rr: "Roraima", sc: "Santa Catarina", se: "Sergipe", sp: "São Paulo", to: "Tocantins" };
  const alesp = antes.alesp.members.map((m) => ({ ...m, t: toks(m.name), n: strip(m.name) }));
  return {
    UFNAME,
    governador(uf, c) {
      const g = govAt.get(UFNAME[uf]);
      if (!g) return null;
      const a = new Set(toks(c.name)), b = toks(g.name);
      const ov = b.filter((t) => a.has(t)).length;
      return ov >= Math.min(2, b.length) && ov / b.length >= 0.75 ? { party: g.party, interino: g.interino } : null;
    },
    senador(uf, c) {
      const h = find(senEver, uf, c);
      return h ? { party: null } : null;
    },
    federal(uf, c) {
      const h = find(camEver, uf, c);
      return h ? { party: h.party, current: camCur.has(h.id) } : null;
    },
    estadual(uf, c) {
      const urna = strip(c.urna), full = new Set(toks(c.name));
      const h = alesp.find((x) => x.n === urna) || alesp.find((x) => x.t.length >= 2 && x.t.every((t) => full.has(t)));
      return h ? { party: h.party } : null;
    },
  };
}

// ---------- montagem ----------
async function main() {
  const antesPath = new URL("data/antes.json", ROOT);
  if (!fs.existsSync(antesPath)) {
    console.log("  sem data/antes.json — rode scripts/antes.mjs");
    return;
  }
  const antes = JSON.parse(fs.readFileSync(antesPath, "utf8"));
  const M = makeMatchers(antes);
  const R = await collect();
  const out = { updated: new Date().toISOString(), scope: { federal: SCOPE_FED, estadual: SCOPE_EST }, status: {}, eleitos: {}, composicao: {}, metricas: {} };
  const mk = (kind, uf, c) => {
    const prev = kind === "governador" || kind === "senador" || kind === "federal" || kind === "estadual" ? M[kind](uf, c) : null;
    return {
      uf: uf.toUpperCase(), name: c.urna, fullName: c.name, party: c.party, number: c.number, votes: c.votes, pct: c.pct, status: c.status,
      incumbent: !!prev, prevParty: prev?.party || null, prevCurrent: prev?.current ?? null,
      projecao: /proje[çc][ãa]o/i.test(c.status),
    };
  };
  const isElected = (kind, c) => (kind === "governador" ? c.status === "Eleito" : c.elected);
  for (const kind of ["governador", "senador", "federal", "estadual"]) {
    const list = [];
    let done = 0, total = 0, pendingUF = [], runoff = [], projUF = [];
    for (const [uf, r] of Object.entries(R[kind]).sort(([a], [b]) => a.localeCompare(b))) {
      if (!r) { pendingUF.push(uf); total++; continue; }
      total++;
      if (r.final) done++;
      else if (r.projected) projUF.push(uf);
      else pendingUF.push(uf);
      if (kind === "governador" && r.cands.some((c) => /2º turno/i.test(c.status))) runoff.push(uf);
      for (const c of r.cands) if (isElected(kind, c)) list.push(mk(kind, uf, c));
    }
    out.eleitos[kind] = list.sort((a, b) => a.uf.localeCompare(b.uf) || b.votes - a.votes);
    out.status[kind] = { ufsFinais: done, ufsTotal: total, pendentes: pendingUF.map((u) => u.toUpperCase()).sort(), projetadas: projUF.map((u) => u.toUpperCase()).sort(), segundoTurno: runoff.map((u) => u.toUpperCase()).sort(), vagas: Object.values(R[kind]).reduce((s, r) => s + (r?.vagas || 0), 0) };
  }
  {
    const p2 = R.presidente2 && R.presidente2.cands.some((c) => c.elected || c.status === "Eleito") ? R.presidente2 : null;
    const p = p2 || R.presidente;
    out.presidente = p
      ? {
          turno: p2 ? 2 : 1,
          final: p.final,
          apuradas: p.sectionsPct,
          eleito: p2 ? p2.cands.find((c) => c.elected || c.status === "Eleito")?.urna || null : null,
          candidatos: [...p.cands].sort((a, b) => b.votes - a.votes).slice(0, p2 ? 2 : 4).map((c) => ({ name: c.urna, party: c.party, pct: c.pct, votes: c.votes, status: c.status })),
        }
      : null;
  }
  out.status.presidente = out.presidente;
  out.status.governador.rjDecidido2T = !!R.governador.rj?.turno2;

  // ---- composição antes × depois por casa ----
  const finalUF = (kind) => Object.entries(R[kind]).filter(([, r]) => r?.final || r?.projected).map(([u]) => u).sort(); // fechadas + projetadas
  const build = (antesCounts, elected, extra = {}) => {
    // "PCdoB" (Câmara) e "PC do B" (TSE) são o mesmo partido: junta pela chave canônica
    const ac = {};
    const label = {};
    for (const [p, n] of Object.entries(antesCounts)) {
      ac[canon(p)] = (ac[canon(p)] || 0) + n;
      label[canon(p)] = p;
    }
    for (const e of elected) label[canon(e.party)] = e.party; // prefere a sigla do TSE
    const parties = new Set([...Object.keys(ac), ...elected.map((e) => canon(e.party))]);
    const rows = [];
    for (const k of parties) {
      const p = label[k];
      const el = elected.filter((e) => canon(e.party) === k);
      const a = ac[k] || 0;
      const reel = el.filter((e) => e.incumbent).length;
      const fromParty = elected.filter((e) => e.incumbent && e.prevParty && canon(e.prevParty) === k).length; // reeleitos que já eram desse partido
      rows.push({ party: p, color: colorOf(p), antes: a, depois: el.length, saldo: el.length - a, reeleitos: reel, novos: el.length - reel, saiu: Math.max(0, a - fromParty), entrou: el.length - fromParty });
    }
    rows.sort((x, y) => y.depois - x.depois || y.antes - x.antes);
    return { ...extra, rows };
  };
  const countBy = (list, f) => list.reduce((o, x) => (inc(o, f(x)), o), {});

  // governadores (27 UFs; "antes" = governador atual)
  {
    const fin = out.eleitos.governador.filter((g) => g.status === "Eleito");
    const antesC = countBy(antes.governadores.filter((g) => g.party), (g) => g.party);
    out.composicao.governadores = build(antesC, fin, { nota: `${fin.length} de 27 já definidos; ${out.status.governador.segundoTurno.length} vão a 2º turno` });
  }
  // senado: 27 que continuam + 54 em disputa
  {
    const cont = antes.senado.current.filter((s) => s.continues);
    const disp = antes.senado.current.filter((s) => !s.continues);
    const el = out.eleitos.senador;
    const antesC = countBy(disp, (s) => s.party);
    const base = build(antesC, el, { vagasEmDisputa: disp.length, definidos: el.length });
    // casa inteira: soma quem continua
    const canonCount = (o) => Object.entries(o).reduce((m, [p, n]) => ((m[canon(p)] = (m[canon(p)] || 0) + n), m), {});
    const contC = canonCount(countBy(cont, (s) => s.party));
    const antesK = canonCount(antesC);
    for (const r of base.rows) {
      r.casaAntes = (antesK[canon(r.party)] || 0) + (contC[canon(r.party)] || 0);
      r.casaDepois = r.depois + (contC[canon(r.party)] || 0);
    }
    for (const [k, n] of Object.entries(contC)) if (!base.rows.find((r) => canon(r.party) === k)) base.rows.push({ party: cont.find((x) => canon(x.party) === k).party, color: colorOf(k), antes: 0, depois: 0, saldo: 0, reeleitos: 0, novos: 0, saiu: 0, entrou: 0, casaAntes: n, casaDepois: n });
    out.composicao.senado = base;
  }
  // câmara (Sul+Sudeste, só UFs já finais)
  {
    const ufs = finalUF("federal");
    const el = out.eleitos.federal.filter((e) => ufs.includes(e.uf.toLowerCase()));
    const antesC = countBy(antes.camara.current.filter((d) => ufs.includes(d.uf.toLowerCase())), (d) => d.party);
    out.composicao.camara = build(antesC, el, { ufs: ufs.map((u) => u.toUpperCase()), pendentes: out.status.federal.pendentes, projetadas: out.status.federal.projetadas });
  }
  // alesp (SP)
  {
    const ufs = finalUF("estadual");
    const el = ufs.length ? out.eleitos.estadual : [];
    out.composicao.alesp = build(antes.alesp.seats, el, { ufs: ufs.map((u) => u.toUpperCase()), pendentes: out.status.estadual.pendentes, projetadas: out.status.estadual.projetadas });
  }

  // ---- métricas ----
  const metr = (list) => {
    const n = list.length;
    if (!n) return null;
    const reel = list.filter((x) => x.incumbent).length;
    const troca = list.filter((x) => x.incumbent && x.prevParty && canon(x.prevParty) !== canon(x.party)).length;
    return { n, reeleitos: reel, renovacaoPct: +(((n - reel) / n) * 100).toFixed(1), trocaramPartido: troca };
  };
  out.metricas = {
    governadores: metr(out.eleitos.governador.filter((g) => g.status === "Eleito")),
    senado: metr(out.eleitos.senador),
    camara: metr(out.eleitos.federal.filter((e) => finalUF("federal").includes(e.uf.toLowerCase()))),
    alesp: metr(finalUF("estadual").length ? out.eleitos.estadual : []),
  };
  // qualidade do cruzamento nome×nome (transparência)
  out.metodo = "Eleitos: apuração oficial do TSE. “Já ocupava o cargo” = nome encontrado na 57ª legislatura (Câmara/Senado, APIs oficiais), no Alesp atual (Wikipédia) ou como governador atual — cruzamento por nome, pode errar em homônimos.";

  // data/ é versionado e commitado pelo bot: sem timestamp, pra só mudar quando o TSE mudar de fato
  const { updated, ...stable } = out;
  fs.writeFileSync(new URL("data/eleitos.json", ROOT), JSON.stringify(stable, null, 1) + "\n");
  fs.mkdirSync(new URL("site/data/", ROOT), { recursive: true });
  fs.writeFileSync(new URL("site/data/eleitos.json", ROOT), JSON.stringify(out) + "\n");
  const s = out.status;
  console.log(`  governadores ${out.eleitos.governador.length}/27 (${s.governador.segundoTurno.length} em 2º turno) · senadores ${out.eleitos.senador.length}/54 · federais ${out.eleitos.federal.length}/${s.federal.vagas} (projeção ${s.federal.projetadas}; pend. ${s.federal.pendentes}) · estaduais SP ${out.eleitos.estadual.length}/94 (projeção ${s.estadual.projetadas})`);
  console.log("  -> data/eleitos.json");
}
main().catch((e) => {
  console.warn("eleitos.mjs falhou:", e.stack || e.message);
  process.exit(0);
});
