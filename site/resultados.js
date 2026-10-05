let ROOT = document;
const $ = (s) => ROOT.querySelector(s);
const TEMPLATE = `
  <h2>Pesquisas × resultado — 1º turno 2026</h2>
  <p class="lead">
    Comparo a <b>tendência final</b> do agregador (com a faixa de ~90%) com o <b>resultado oficial</b>.
    A estimativa é a <b>congelada na véspera</b> (o modelo que estava no ar), mesmo que ele seja recalibrado depois.
    Estimativa e resultado são renormalizados entre os candidatos exibidos, para ficarem na mesma base
    (votos válidos). No <b>Senado</b> cada eleitor vota em dois nomes, então a comparação é aproximada.
    Corridas ainda em apuração aparecem marcadas. No gráfico de cada corrida, os círculos ◎ no dia da eleição mostram o resultado.
  </p>
  <div id="rs-headline" class="bt-headline"></div>
  <div id="rs-races"></div>
  <div id="rs-round2"></div>
  <h3>Institutos — erro da última pesquisa</h3>
  <p class="lead">
    Erro médio (p.p.) da última pesquisa de cada instituto, feita até 14 dias antes da eleição, contra o
    resultado. “Viés” = quanto o instituto errou no vencedor real (negativo = subestimou).
  </p>
  <div class="table-scroll"><table id="rs-pollsters"></table></div>
  <div class="table-scroll"><table id="rs-pollsters2"></table></div>
  <h3>Abstenção, brancos e nulos</h3>
  <div id="rs-turnout" class="table-scroll"></div>
  <p class="foot" id="rs-foot"></p>
`;
const fmt = (v, d = 1) => v.toFixed(d).replace(".", ",");
const sgn = (e) => (e > 0 ? "+" : e < 0 ? "−" : "") + fmt(Math.abs(e));
const KIND = { presidente: "Presidente", governador: "Governador", senado: "Senado" };

function statCard(label, big, unit, sub) {
  return `<div class="bt-stat"><div class="yr">${label}</div><div class="big">${big}<span>${unit}</span></div><div class="cmp">${sub}</div></div>`;
}

function raceCard(r) {
  const hit = r.winnerHit;
  const rows = r.candidates
    .map((c) => {
      const lo = Math.max(0, c.lo), hi = Math.min(100, c.hi);
      return `<tr>
        <td><span class="dot" style="background:${c.color}"></span>${c.name}</td>
        <td>${fmt(c.est)}% <span class="muted">(${fmt(lo)}–${fmt(hi)})</span></td>
        <td><b>${fmt(c.real)}%</b></td>
        <td class="${Math.abs(c.err) > 2 ? "err-big" : ""}">${sgn(c.err)}</td>
        <td>${c.inBand ? "✓" : '<span class="err-big">✗</span>'}</td></tr>`;
    })
    .join("");
  return `<section class="bt-cycle">
    <h3 style="margin:0">${r.group === "Presidente" ? "Presidente" : KIND[r.kind] + " — " + r.group}</h3>
    <p class="lead" style="margin:6px 0 10px">
      ${r.runoff && r.runoff.length ? `Vão ao 2º turno: <b>${r.runoff.join(" × ")}</b>` : r.electedNames && r.electedNames.length ? `Eleit${r.electedNames.length > 1 ? "os" : "o"}: <b>${r.electedNames.join(" e ")}</b>` : `Mais votado: <b>${r.actualWinner}</b>`}
      · líder da tendência: <b>${r.predictedWinner}</b> ${hit ? "✓" : '<span class="err-big">✗</span>'}
      · erro médio <b>${fmt(r.mae, 2)} p.p.</b> · ${r.inBandPct}% dentro da faixa
      ${r.complete ? "" : ` · <i>apuração em andamento${r.sectionsPct != null ? " (" + fmt(r.sectionsPct, 0) + "% das seções)" : ""}</i>`}
    </p>
    <div class="table-scroll"><table class="bt-tbl">
      <thead><tr><th>Candidato</th><th>Estimativa (faixa 90%)</th><th>Resultado</th><th>Erro</th><th>Na faixa</th></tr></thead>
      <tbody>${rows}</tbody></table></div></section>`;
}

function headline(races) {
  const hits = races.filter((r) => r.winnerHit).length;
  const mae = races.reduce((s, r) => s + r.mae, 0) / races.length;
  const all = races.flatMap((r) => r.candidates);
  const inBand = (all.filter((c) => c.inBand).length / all.length) * 100;
  const big = [...all].sort((a, b) => Math.abs(b.err) - Math.abs(a.err))[0];
  const bigRace = races.find((r) => r.candidates.includes(big));
  return (
    statCard("Líder certo", `${hits}/${races.length}`, races.length > 1 ? "corridas" : "corrida", "o líder da tendência foi o mais votado") +
    statCard("Erro médio", fmt(mae, 2), "p.p.", "por candidato") +
    statCard("Dentro da faixa", fmt(inBand, 0), "%", "meta do modelo: ~90%") +
    statCard("Maior surpresa", sgn(big.err), "p.p.", `${big.name} (${bigRace.group})`)
  );
}

function pollsterTable(list) {
  const by = new Map();
  for (const p of list) {
    const a = by.get(p.pollster) || { mae: [], bias: [], hit: 0, n: 0 };
    a.mae.push(p.mae); if (p.bias != null) a.bias.push(p.bias); a.hit += p.winnerHit ? 1 : 0; a.n++;
    by.set(p.pollster, a);
  }
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const rows = [...by].map(([name, a]) => ({ name, mae: avg(a.mae), bias: a.bias.length ? avg(a.bias) : 0, hit: a.hit, n: a.n })).sort((a, b) => a.mae - b.mae);
  return (
    "<thead><tr><th>Instituto</th><th>Erro médio</th><th>Viés no vencedor</th><th>Corridas</th><th>Vencedor certo</th></tr></thead><tbody>" +
    rows.map((p) => `<tr><td>${p.name}</td><td>${fmt(p.mae, 2)}</td><td class="${Math.abs(p.bias) > 2.5 ? "err-big" : ""}">${sgn(p.bias)}</td><td>${p.n}</td><td>${p.hit}/${p.n}</td></tr>`).join("") +
    "</tbody>"
  );
}

export async function mount(root) {
  ROOT = root;
  root.innerHTML = TEMPLATE;
  try {
    await render();
  } catch (e) {
    $("#rs-headline").textContent = "Não consegui carregar os resultados: " + e.message;
  }
}

async function render() {
  const d = await (await fetch("data/resultados.json", { cache: "no-store" })).json();
  const all = d.races || [];
  const r1 = all.filter((r) => r.round !== "2T");
  const r2 = all.filter((r) => r.round === "2T");
  if (!r1.length) {
    $("#rs-headline").innerHTML = `<p class="lead">Ainda sem resultados publicados na fonte. Esta página se atualiza sozinha.</p>`;
    return;
  }
  $("#rs-headline").innerHTML = headline(r1);
  $("#rs-races").innerHTML = r1.map(raceCard).join("");

  // 2º turno (25/10): presidente e governador do RJ
  $("#rs-round2").innerHTML = r2.length
    ? `<h2 style="margin-top:34px">2º turno — 25/10</h2><div class="bt-headline">${headline(r2)}</div>${r2.map(raceCard).join("")}`
    : `<h3>2º turno</h3><p class="lead">Aparece aqui depois de 25/10 (presidente: Flávio × Lula; governo do RJ: Paes × Ruas).</p>`;

  // institutos
  $("#rs-pollsters").innerHTML = pollsterTable((d.pollsters || []).filter((p) => p.round !== "2T"));
  const p2 = (d.pollsters || []).filter((p) => p.round === "2T");
  if (p2.length) $("#rs-pollsters2").innerHTML = pollsterTable(p2);

  // abstenção etc. (presidente 2026 vs 2022)
  const t = d.turnout?.presidente, p22 = d.turnout22;
  if (t) {
    const row = (nome, a, b) => `<tr><td>${nome}</td><td>${a != null ? fmt(a, 2) + "%" : "–"}</td><td>${b != null ? fmt(b, 2) + "%" : "–"}</td><td>${a != null && b != null ? sgn(a - b) + " p.p." : ""}</td></tr>`;
    $("#rs-turnout").innerHTML =
      "<table class='bt-tbl'><thead><tr><th>Presidente, 1º turno</th><th>2026</th><th>2022</th><th>Diferença</th></tr></thead><tbody>" +
      row("Abstenção", t.abstencoes?.pct, p22?.abstencoes?.pct) +
      row("Votos nulos", t.nulos?.pct, p22?.nulos?.pct) +
      row("Votos em branco", t.brancos?.pct, p22?.brancos?.pct) +
      "</tbody></table>";
  }
  $("#rs-foot").textContent = `Fonte dos resultados: apuração oficial do TSE (resultados.tse.jus.br). Atualizado em ${new Date(d.updated).toLocaleString("pt-BR")}.`;
}

