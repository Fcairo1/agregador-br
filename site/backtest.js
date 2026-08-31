const SVGNS = "http://www.w3.org/2000/svg";
const $ = (s, r = document) => r.querySelector(s);
const parseT = (iso) => new Date(iso + "T00:00:00Z").getTime();

// nomes e cores (o backtest.json guarda só chaves + números)
const CAND = {
  lula: { name: "Lula", color: "#E13037" },
  bolsonaro: { name: "Bolsonaro", color: "#1F4F9E" },
  haddad: { name: "Haddad", color: "#E13037" },
  ciro: { name: "Ciro", color: "#F59E1B" },
  alckmin: { name: "Alckmin", color: "#0E86C9" },
  tebet: { name: "Tebet", color: "#00A7A0" },
  soraya: { name: "Soraya", color: "#7C4DD1" },
  amoedo: { name: "Amoêdo", color: "#B8912B" },
  marina: { name: "Marina", color: "#1B9E5A" },
  meirelles: { name: "Meirelles", color: "#6E8B3D" },
};
const cn = (k) => CAND[k] || { name: k, color: "#8C8C8C" };
const fmtErr = (e) => (e > 0 ? "+" : "") + e.toFixed(1);

function el(tag, attrs = {}, kids = []) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  for (const c of [].concat(kids)) n.append(c);
  return n;
}

// mini-gráfico de um ciclo: linhas do modelo + marcadores do resultado real na ponta
function chart(cy) {
  const W = 1000;
  const H = 380;
  const M = { t: 18, r: 120, b: 30, l: 40 };
  const PW = W - M.l - M.r;
  const PH = H - M.t - M.b;
  const t0 = parseT(cy.xDomain[0]);
  const t1 = parseT(cy.xDomain[1]);
  const keys = Object.keys(cy.series);
  let ymax = 0;
  for (const k of keys) for (const p of cy.series[k]) ymax = Math.max(ymax, p.y);
  for (const k of keys) ymax = Math.max(ymax, cy.result[k] || 0);
  ymax = Math.ceil((ymax + 4) / 10) * 10;
  const x = (t) => M.l + ((t - t0) / (t1 - t0)) * PW;
  const y = (v) => M.t + PH - (v / ymax) * PH;

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "bt-chart", role: "img" });
  // grade y
  for (let v = 0; v <= ymax; v += 10) {
    svg.append(el("line", { class: "gridline", x1: M.l, x2: M.l + PW, y1: y(v), y2: y(v) }));
    const tx = el("text", { x: M.l - 7, y: y(v) + 4, "text-anchor": "end", class: "axtx" });
    tx.textContent = v + "%";
    svg.append(tx);
  }
  // linha da eleição
  svg.append(el("line", { class: "voteline", x1: x(t1), x2: x(t1), y1: M.t, y2: M.t + PH }));

  // ordena por resultado (maior em cima nos rótulos)
  const ordered = keys.slice().sort((a, b) => (cy.result[b] || 0) - (cy.result[a] || 0));
  const labelY = [];
  for (const k of ordered) {
    const c = cn(k);
    const pts = cy.series[k].map((p) => [x(parseT(p.t)), y(p.y)]);
    let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) d += ` L ${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)}`;
    svg.append(el("path", { d, fill: "none", stroke: c.color, "stroke-width": 2.4, "stroke-linejoin": "round" }));
    // marcador do resultado real
    const ry = y(cy.result[k]);
    svg.append(el("circle", { cx: x(t1), cy: ry, r: 4.5, fill: c.color, stroke: "var(--panel)", "stroke-width": 2 }));
    // rótulo à direita (nome + resultado), com anti-colisão simples
    let ly = ry;
    while (labelY.some((v) => Math.abs(v - ly) < 15)) ly += 15;
    labelY.push(ly);
    const g = el("text", { x: M.l + PW + 10, y: ly + 4, class: "bt-lbl", fill: c.color });
    g.textContent = `${c.name} ${cy.result[k].toFixed(1)}`;
    svg.append(g);
  }
  return svg;
}

function cycleCard(cy) {
  const wrap = document.createElement("section");
  wrap.className = "bt-cycle";
  wrap.innerHTML = `<h3>${cy.year} <span>· ${cy.nPolls} pesquisas · linha = modelo · bolinha = resultado real</span></h3>`;
  wrap.append(chart(cy));

  const rows = Object.entries(cy.est)
    .sort((a, b) => b[1].result - a[1].result)
    .map(([k, v]) => {
      const big = Math.abs(v.err) >= 3;
      return `<tr>
        <td class="poll-name"><span class="dot" style="background:${cn(k).color}"></span>${cn(k).name}</td>
        <td>${v.est.toFixed(1)}</td>
        <td class="muted">${v.result.toFixed(1)}</td>
        <td class="${big ? "err-big" : ""}">${fmtErr(v.err)}</td>
      </tr>`;
    })
    .join("");
  const tbl = document.createElement("div");
  tbl.className = "table-scroll";
  tbl.innerHTML = `<table class="bt-tbl">
    <thead><tr><th>Candidato</th><th>Agregador</th><th>Resultado</th><th>Erro (p.p.)</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
  wrap.append(tbl);
  return wrap;
}

function headline(cycles) {
  const box = $("#headline");
  box.innerHTML = cycles
    .map(
      (c) => `<div class="bt-stat">
        <div class="yr">${c.year}</div>
        <div class="big">${c.aggregatorMAE.toFixed(1)}<span>p.p.</span></div>
        <div class="cmp">erro do agregador · pesquisa individual média: <b>${c.pollsFinalMAE.toFixed(1)}</b></div>
      </div>`
    )
    .join("");
}

function pollsterTable(list) {
  $("#pollsters").innerHTML =
    `<thead><tr><th>Instituto</th><th>Ciclos</th><th>Erro final (MAE)</th><th>Peso hoje</th></tr></thead><tbody>` +
    list
      .map(
        (r) => `<tr>
        <td class="poll-name">${r.canon}</td>
        <td class="muted">${r.cycles}</td>
        <td>${r.maeFinal.toFixed(2)}</td>
        <td class="${r.weight >= 1.03 ? "up" : r.weight <= 0.97 ? "down" : ""}">${r.weight.toFixed(2)}×</td>
      </tr>`
      )
      .join("") +
    `</tbody>`;
}

const data = await (await fetch("data/backtest.json", { cache: "no-cache" })).json();
headline(data.cycles);
const host = $("#cycles");
for (const cy of data.cycles) host.append(cycleCard(cy));
pollsterTable(data.pollsters);
