const SVGNS = "http://www.w3.org/2000/svg";
const VB = { w: 1000, h: 560 };
const M = { t: 26, r: 140, b: 40, l: 46 };
const PW = VB.w - M.l - M.r;
const PH = VB.h - M.t - M.b;
const GAP_DAYS = 9;
const DAY = 86400000;

const RACES = [
  { key: "presidente", label: "Presidente", wiki: "https://pt.wikipedia.org/wiki/Pesquisas_de_opini%C3%A3o_para_a_elei%C3%A7%C3%A3o_presidencial_no_Brasil_em_2026" },
  { key: "sp-governador", label: "Governador de SP", wiki: "https://pt.wikipedia.org/wiki/Pesquisas_eleitorais_para_a_elei%C3%A7%C3%A3o_estadual_de_2026_em_S%C3%A3o_Paulo" },
];

const $ = (s, r = document) => r.querySelector(s);
const svg = $("#chart");
const tip = $("#tooltip");
const state = { race: RACES[0].key, data: null, hidden: new Set(), geom: null, showAllPolls: false };

function el(tag, attrs = {}, kids = []) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  for (const c of [].concat(kids)) n.append(c);
  return n;
}
const fmtDate = (iso) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" });
const parseT = (iso) => new Date(iso + "T00:00:00Z").getTime();

// ---------- geometry ----------
function buildGeom(data) {
  const t0 = parseT(data.xDomain[0]);
  const t1 = parseT(data.xDomain[1]);
  const visible = data.candidates.filter((c) => !state.hidden.has(c.key));
  let hiMax = 0;
  for (const c of visible) for (const b of c.band) hiMax = Math.max(hiMax, b.hi);
  for (const c of visible) for (const p of c.line) hiMax = Math.max(hiMax, p.y);
  const step = hiMax <= 24 ? 5 : hiMax <= 60 ? 10 : 20;
  const yMax = Math.max(step, Math.ceil((hiMax + step * 0.35) / step) * step);
  const x = (t) => M.l + ((t - t0) / (t1 - t0 || 1)) * PW;
  const y = (v) => M.t + PH - (v / yMax) * PH;
  return { t0, t1, x, y, yMax, step };
}

// ---------- path helpers ----------
function smooth(pts, moveTo = true) {
  if (!pts.length) return "";
  if (pts.length === 1) return `${moveTo ? "M" : "L"} ${pts[0][0]} ${pts[0][1]}`;
  const d = [`${moveTo ? "M" : "L"} ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d.push(`C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`);
  }
  return d.join(" ");
}
// quebra uma série {t,...} em segmentos contínuos (sem buracos temporais)
function segments(arr) {
  const segs = [];
  let cur = [];
  for (let i = 0; i < arr.length; i++) {
    if (i > 0 && parseT(arr[i].t) - parseT(arr[i - 1].t) > GAP_DAYS * DAY) {
      if (cur.length) segs.push(cur);
      cur = [];
    }
    cur.push(arr[i]);
  }
  if (cur.length) segs.push(cur);
  return segs;
}

// ---------- render ----------
function render() {
  const data = state.data;
  const g = (state.geom = buildGeom(data));
  svg.textContent = "";

  // --- grid + eixo y ---
  const axis = el("g", { class: "axis" });
  for (let v = 0; v <= g.yMax; v += g.step) {
    const yy = g.y(v);
    axis.append(el("line", { class: "gridline", x1: M.l, x2: M.l + PW, y1: yy, y2: yy }));
    axis.append(el("text", { x: M.l - 8, y: yy + 4, "text-anchor": "end" }, [txt(`${v}%`)]));
  }
  // --- eixo x: meses ---
  const d0 = new Date(g.t0);
  let mk = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), 1));
  while (mk.getTime() <= g.t1) {
    if (mk.getTime() >= g.t0) {
      const xx = g.x(mk.getTime());
      axis.append(el("line", { class: "gridline", x1: xx, x2: xx, y1: M.t, y2: M.t + PH }));
      axis.append(
        el("text", { x: xx, y: M.t + PH + 22, "text-anchor": "middle" }, [
          txt(mk.toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" }).replace(".", "")),
        ])
      );
    }
    mk = new Date(Date.UTC(mk.getUTCFullYear(), mk.getUTCMonth() + 1, 1));
  }
  svg.append(axis);

  const visible = data.candidates.filter((c) => !state.hidden.has(c.key));

  // --- faixas (aura) ---
  const bandsG = el("g");
  for (const c of visible) {
    for (const seg of segments(c.band)) {
      if (seg.length < 2) continue;
      const hi = seg.map((p) => [g.x(parseT(p.t)), g.y(p.hi)]);
      const lo = seg.map((p) => [g.x(parseT(p.t)), g.y(p.lo)]).reverse();
      const dd = `${smooth(hi, true)} ${smooth(lo, false)} Z`;
      const path = el("path", { class: "band", d: dd, fill: c.color, "fill-opacity": 0.15 });
      bandsG.append(path);
    }
  }
  svg.append(bandsG);

  // --- pontos das pesquisas ---
  const dotsG = el("g");
  for (const c of visible) {
    for (const p of c.polls) {
      const t = parseT(p.t);
      if (t < g.t0 || t > g.t1) continue;
      dotsG.append(
        el("circle", { class: "pollpt", cx: g.x(t), cy: g.y(p.y), r: 2.3, fill: c.color, "fill-opacity": 0.16 })
      );
    }
  }
  svg.append(dotsG);

  // --- linhas ---
  const linesG = el("g");
  const lineEls = [];
  for (const c of visible) {
    for (const seg of segments(c.line)) {
      if (seg.length < 2) continue;
      const pts = seg.map((p) => [g.x(parseT(p.t)), g.y(p.y)]);
      const path = el("path", { class: "tline", d: smooth(pts), stroke: c.color, "stroke-width": 2.6 });
      path.dataset.key = c.key;
      linesG.append(path);
      lineEls.push(path);
    }
  }
  svg.append(linesG);

  // --- rótulos no fim da linha ---
  const labelsG = el("g");
  const labels = visible
    .map((c) => {
      const last = c.line[c.line.length - 1];
      return last ? { c, y: g.y(last.y), v: last.y } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) {
    if (labels[i].y - labels[i - 1].y < 15) labels[i].y = labels[i - 1].y + 15;
  }
  for (const L of labels) {
    const gx = M.l + PW + 8;
    labelsG.append(
      el("text", { class: "endlabel", x: gx, y: L.y + 4, fill: L.c.color }, [
        txt(L.c.name + " "),
        tspan(`${L.v.toFixed(1)}%`, "p"),
      ])
    );
  }
  svg.append(labelsG);

  // --- camada de hover ---
  const focus = el("g", { class: "hide" });
  const cross = el("line", { class: "crosshair", y1: M.t, y2: M.t + PH });
  focus.append(cross);
  const fdots = el("g");
  focus.append(fdots);
  svg.append(focus);

  const overlay = el("rect", { x: M.l, y: M.t, width: PW, height: PH, fill: "transparent" });
  svg.append(overlay);
  wireHover(overlay, focus, cross, fdots);

  // --- animação de entrada ---
  requestAnimationFrame(() => {
    for (const p of lineEls) {
      const len = p.getTotalLength();
      p.style.transition = "none";
      p.style.strokeDasharray = len;
      p.style.strokeDashoffset = len;
      p.getBoundingClientRect();
      p.style.transition = "stroke-dashoffset .9s ease";
      p.style.strokeDashoffset = 0;
    }
    for (const b of bandsG.children) {
      b.style.opacity = 0;
      b.getBoundingClientRect();
      b.style.opacity = 1;
    }
  });

  renderLegend();
  renderMeta();
  renderTable();
}

// ---------- tabela de pesquisas ----------
const SHORT_MONTH = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function fmtRange(start, end) {
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  const em = SHORT_MONTH[e.getUTCMonth()];
  if (start === end) return `${e.getUTCDate()} ${em}`;
  const sm = SHORT_MONTH[s.getUTCMonth()];
  return sm === em
    ? `${s.getUTCDate()}–${e.getUTCDate()} ${em}`
    : `${s.getUTCDate()} ${sm} – ${e.getUTCDate()} ${em}`;
}
function renderTable() {
  const d = state.data;
  const shown = d.shown;
  const table = document.querySelector("#polltable");
  const rows = state.showAllPolls ? d.polls : d.polls.slice(0, 12);

  const head =
    "<thead><tr><th>Instituto</th><th>Período</th><th>Amostra</th>" +
    shown.map((s) => `<th style="color:${s.color}">${s.name}</th>`).join("") +
    "<th></th></tr></thead>";

  const body =
    "<tbody>" +
    rows
      .map((p) => {
        let lead = -1;
        for (const s of shown) if ((p.values[s.key] ?? -1) > lead) lead = p.values[s.key] ?? -1;
        const cells = shown
          .map((s) => {
            const v = p.values[s.key];
            if (v == null) return `<td class="muted">–</td>`;
            return `<td class="${v === lead ? "lead" : ""}">${v.toFixed(1)}</td>`;
          })
          .join("");
        const src = p.source
          ? `<td><a href="${p.source}" target="_blank" rel="noopener" title="fonte">↗</a></td>`
          : `<td></td>`;
        return `<tr><td class="poll-name">${p.pollster}</td><td class="muted">${fmtRange(
          p.start,
          p.end
        )}</td><td class="muted">${p.n ? p.n.toLocaleString("pt-BR") : "–"}</td>${cells}${src}</tr>`;
      })
      .join("") +
    "</tbody>";

  table.innerHTML = head + body;
  document.querySelector("#polls-count").textContent = `· ${d.nPolls} no total, ${d.nWithSource} com link de fonte`;
  const tg = document.querySelector("#polls-toggle");
  tg.textContent = state.showAllPolls ? "ver menos" : `ver todas (${d.polls.length})`;
  tg.hidden = d.polls.length <= 12;
  tg.onclick = () => {
    state.showAllPolls = !state.showAllPolls;
    renderTable();
  };
}

function txt(s) {
  return document.createTextNode(s);
}
function tspan(s, cls) {
  const t = document.createElementNS(SVGNS, "tspan");
  if (cls) t.setAttribute("class", cls);
  t.textContent = s;
  return t;
}

// ---------- hover ----------
function allDates() {
  const set = new Set();
  for (const c of state.data.candidates) for (const p of c.line) set.add(p.t);
  return [...set].sort();
}
function wireHover(overlay, focus, cross, fdots) {
  const dates = allDates();
  const byKey = new Map();
  for (const c of state.data.candidates) {
    const m = new Map();
    for (const p of c.line) m.set(p.t, p.y);
    byKey.set(c.key, m);
  }
  const move = (evt) => {
    const e = evt.touches ? evt.touches[0] : evt;
    const r = svg.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * VB.w;
    const g = state.geom;
    const t = g.t0 + ((vx - M.l) / PW) * (g.t1 - g.t0);
    let best = dates[0];
    let bd = Infinity;
    for (const ds of dates) {
      const dd = Math.abs(parseT(ds) - t);
      if (dd < bd) {
        bd = dd;
        best = ds;
      }
    }
    const bx = g.x(parseT(best));
    cross.setAttribute("x1", bx);
    cross.setAttribute("x2", bx);
    fdots.textContent = "";
    const rows = [];
    for (const c of state.data.candidates) {
      if (state.hidden.has(c.key)) continue;
      const yv = byKey.get(c.key).get(best);
      if (yv == null) continue;
      fdots.append(el("circle", { class: "focusdot", cx: bx, cy: g.y(yv), r: 4, fill: c.color }));
      rows.push({ c, yv });
    }
    rows.sort((a, b) => b.yv - a.yv);
    tip.innerHTML =
      `<h4>${fmtDate(best)}</h4>` +
      rows
        .map(
          (r) =>
            `<div class="row"><span class="nm"><span class="dot" style="background:${r.c.color}"></span>${r.c.name}</span><span class="v">${r.yv.toFixed(1)}%</span></div>`
        )
        .join("");
    const holder = $("#holder").getBoundingClientRect();
    const px = (bx / VB.w) * holder.width;
    const py = (g.y(rows[0]?.yv ?? g.yMax) / VB.h) * holder.height;
    tip.style.left = Math.max(80, Math.min(holder.width - 80, px)) + "px";
    tip.style.top = Math.max(72, py) + "px";
    tip.hidden = false;
    focus.classList.remove("hide");
  };
  const leave = () => {
    focus.classList.add("hide");
    tip.hidden = true;
  };
  overlay.addEventListener("mousemove", move);
  overlay.addEventListener("mouseleave", leave);
  overlay.addEventListener("touchstart", move, { passive: true });
  overlay.addEventListener("touchmove", move, { passive: true });
  overlay.addEventListener("touchend", leave);
}

// ---------- legend / meta / tabs ----------
function renderLegend() {
  const box = $("#legend");
  box.textContent = "";
  for (const c of state.data.candidates) {
    const off = state.hidden.has(c.key);
    const b = document.createElement("button");
    b.className = off ? "off" : "";
    const last = c.line[c.line.length - 1];
    b.innerHTML = `<span class="dot" style="background:${c.color}"></span>${c.name} <span class="pct">${
      last ? last.y.toFixed(1) + "%" : "—"
    }</span>`;
    b.onclick = () => {
      if (state.hidden.has(c.key)) state.hidden.delete(c.key);
      else state.hidden.add(c.key);
      render();
    };
    box.append(b);
  }
}
function renderMeta() {
  const d = state.data;
  $("#race-title").textContent = d.label;
  $("#race-sub").textContent = `${d.nPolls} pesquisas · última em ${fmtDate(d.lastPoll)} · ${d.pollsters.length} institutos`;
  const rc = RACES.find((r) => r.key === state.race);
  $("#src-link").href = rc.wiki;
}
function renderTabs() {
  const box = $("#races");
  box.textContent = "";
  for (const r of RACES) {
    const b = document.createElement("button");
    b.textContent = r.label;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(r.key === state.race));
    b.onclick = () => {
      if (r.key === state.race) return;
      state.race = r.key;
      state.hidden.clear();
      renderTabs();
      load();
    };
    box.append(b);
  }
}

async function load() {
  svg.style.opacity = 0.25;
  try {
    const res = await fetch(`data/${state.race}.json`, { cache: "no-cache" });
    state.data = await res.json();
    render();
  } catch (e) {
    svg.textContent = "";
    svg.append(el("text", { x: 40, y: 60, fill: "currentColor" }, [txt("Não foi possível carregar os dados.")]));
    console.error(e);
  }
  svg.style.transition = "opacity .2s";
  svg.style.opacity = 1;
}

let rt;
addEventListener("resize", () => {
  clearTimeout(rt);
  rt = setTimeout(() => state.data && render(), 150);
});

renderTabs();
load();
