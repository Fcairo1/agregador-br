const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = (v, d = 0) => v.toFixed(d).replace(".", ",");
const sgn = (n) => (n > 0 ? "+" + n : n < 0 ? "−" + Math.abs(n) : "0");

const HOUSES = [
  { key: "governadores", kind: "governador", label: "Governadores", unit: "governadores", total: 27 },
  { key: "senado", kind: "senador", label: "Senado", unit: "senadores em disputa", total: 54 },
  { key: "camara", kind: "federal", label: "Câmara (Sul/Sudeste)", unit: "deputados federais", total: null },
  { key: "alesp", kind: "estadual", label: "Assembleia de SP", unit: "deputados estaduais", total: 94 },
];

function badge(p, color) {
  return `<span class="pbadge" style="--c:${color}">${esc(p)}</span>`;
}
function statCard(label, big, unit, sub) {
  return `<div class="bt-stat"><div class="yr">${label}</div><div class="big">${big}<span>${unit}</span></div><div class="cmp">${sub}</div></div>`;
}

function partyTable(h, comp) {
  const rows = comp.rows.filter((r) => r.antes || r.depois);
  const max = Math.max(1, ...rows.map((r) => Math.max(r.antes, r.depois, r.casaAntes || 0, r.casaDepois || 0)));
  const senado = h.key === "senado";
  const body = rows
    .map((r) => {
      const wA = (r.antes / max) * 100, wD = (r.depois / max) * 100;
      const cls = r.saldo > 0 ? "up" : r.saldo < 0 ? "down" : "";
      return `<tr>
        <td>${badge(r.party, r.color)}</td>
        <td class="bars"><div class="bar a" style="width:${wA}%;background:${r.color}"></div><div class="bar d" style="width:${wD}%;background:${r.color}"></div></td>
        <td>${r.antes}</td><td><b>${r.depois}</b></td><td class="sd ${cls}">${sgn(r.saldo)}</td>
        <td>${r.reeleitos}</td><td>${r.novos}</td><td>${r.saiu}</td>
        ${senado ? `<td class="muted">${r.casaAntes}→${r.casaDepois}</td>` : ""}</tr>`;
    })
    .join("");
  return `<div class="table-scroll"><table class="bt-tbl party">
    <thead><tr><th>Partido</th><th class="bh">antes (claro) · depois</th><th>Antes</th><th>Depois</th><th>Saldo</th><th title="eleitos que já ocupavam o cargo">Reeleitos</th><th title="eleitos que não ocupavam o cargo">Novos</th><th title="quem era do partido e não voltou">Saíram</th>${senado ? '<th title="casa inteira (81): inclui os 27 que continuam">Casa (81)</th>' : ""}</tr></thead>
    <tbody>${body}</tbody></table></div>`;
}

function metricCards(m) {
  if (!m) return "";
  return `<div class="bt-headline">` +
    statCard("Renovação", fmt(m.renovacaoPct, 0), "%", `${m.n - m.reeleitos} novos no cargo · ${m.reeleitos} reeleitos`) +
    (m.mulheres != null ? statCard("Mulheres", fmt(m.mulheres, 1), "%", "dos eleitos") : "") +
    (m.negros != null ? statCard("Pretos e pardos", fmt(m.negros, 1), "%", "dos eleitos (autodeclarados)") : "") +
    statCard("Trocaram de partido", m.trocaramPartido, "", "reeleitos por outra sigla") +
    `</div>`;
}

function peopleTable(list, extraNote) {
  const uniq = [...new Set(list.map((x) => x.uf))].sort();
  return `<div class="filters">
      <input id="q" type="search" placeholder="buscar nome ou partido…" />
      <select id="fuf"><option value="">todos os estados</option>${uniq.map((u) => `<option>${u}</option>`).join("")}</select>
      <select id="fnew"><option value="">todos</option><option value="new">só novos no cargo</option><option value="re">só reeleitos</option></select>
    </div>
    ${extraNote || ""}
    <div class="table-scroll"><table class="bt-tbl people"><thead><tr><th>Eleito(a)</th><th>UF</th><th>Partido</th><th>Votos</th><th>%</th><th>No cargo antes?</th></tr></thead><tbody id="people"></tbody></table></div>`;
}
function fillPeople(list, colors) {
  const q = ($("#q")?.value || "").toLowerCase();
  const uf = $("#fuf")?.value || "";
  const nw = $("#fnew")?.value || "";
  const rows = list.filter((x) => (!uf || x.uf === uf) && (!q || (x.name + " " + x.fullName + " " + x.party).toLowerCase().includes(q)) && (!nw || (nw === "new" ? !x.incumbent : x.incumbent)));
  $("#people").innerHTML = rows
    .map(
      (x) => `<tr><td>${esc(x.name)}${/2º turno/i.test(x.status) ? ' <span class="muted">(2º turno)</span>' : ""}</td><td>${x.uf}</td><td>${badge(x.party, colors[x.party] || "#8C8C8C")}</td><td>${x.votes.toLocaleString("pt-BR")}</td><td>${fmt(x.pct, 1)}%</td>
      <td>${x.incumbent ? `reeleito${x.prevParty && x.prevParty.toLowerCase() !== x.party.toLowerCase() ? ` <span class="muted">(vinha do ${esc(x.prevParty)})</span>` : ""}` : "<b>novo</b>"}</td></tr>`
    )
    .join("");
  const c = $("#count");
  if (c) c.textContent = `${rows.length} de ${list.length}`;
}

let D;
function show(key) {
  const h = HOUSES.find((x) => x.key === key);
  const comp = D.composicao[key];
  const list = D.eleitos[h.kind].filter((x) => (h.kind === "governador" ? x.status === "Eleito" : true));
  const st = D.status[h.kind];
  const colors = Object.fromEntries(Object.values(D.composicao).flatMap((c) => c.rows.map((r) => [r.party, r.color])));
  let head = "";
  if (!list.length && h.kind !== "governador") head = "";
  else if (h.kind === "governador") head = `<p class="lead">${list.length} governadores eleitos em 1º turno. Vão a <b>2º turno</b> em ${st.segundoTurno.length} estados: <b>${st.segundoTurno.join(", ")}</b> (25/10).</p>`;
  else if (st.pendentes.length) head = `<p class="lead"><i>Apuração em andamento em: ${st.pendentes.join(", ")}.</i> Os números abaixo cobrem só os estados já concluídos${comp.ufs ? ` (${comp.ufs.join(", ")})` : ""}; o “antes” é recortado para os mesmos estados.</p>`;
  else if (h.kind === "senador") head = `<p class="lead">Todas as 54 vagas definidas. “Antes” = os 54 senadores que ocupavam as cadeiras em disputa; a última coluna mostra a casa inteira (81), somando os 27 que continuam até 2031.</p>`;
  const empty = !list.length && h.kind !== "governador";
  $("#panel").innerHTML = `${head}
    ${empty ? `<p class="lead">Apuração em andamento${st.pendentes.length ? " (" + st.pendentes.join(", ") + ")" : ""}: o TSE ainda não publicou os eleitos desta casa. A página se atualiza sozinha.</p>` : `
    <h3>Antes × depois, por partido</h3>${partyTable(h, comp)}
    <h3>Perfil dos eleitos</h3>${metricCards(D.metricas[key])}
    <h3>Eleitos <span class="muted" id="count"></span></h3>${peopleTable(list)}`}`;
  if (!empty) {
    const go = () => fillPeople(list, colors);
    for (const id of ["#q", "#fuf", "#fnew"]) $(id).addEventListener("input", go);
    go();
  }
  for (const b of document.querySelectorAll("#tabs button")) b.setAttribute("aria-selected", String(b.dataset.k === key));
  history.replaceState(null, "", "#" + key);
}

async function boot() {
  D = await (await fetch("data/eleitos.json", { cache: "no-store" })).json();
  const S = D.status;
  const n = (k) => D.eleitos[k].filter((x) => (k === "governador" ? x.status === "Eleito" : true)).length;
  $("#headline").innerHTML =
    statCard("Governadores", n("governador"), "/ 27", `${S.governador.segundoTurno.length} vão a 2º turno`) +
    statCard("Senadores", n("senador"), "/ 54", S.senador.ufsFinais === S.senador.ufsTotal ? "todas as vagas definidas" : `apuração em ${S.senador.pendentes.join(", ")}`) +
    statCard("Dep. federais", n("federal"), `/ ${S.federal.vagas}`, `Sul e Sudeste${S.federal.pendentes.length ? " · falta " + S.federal.pendentes.join(", ") : ""}`) +
    statCard("Dep. estaduais SP", n("estadual"), "/ 94", S.estadual.pendentes.length ? "apuração em andamento" : "concluída");
  $("#tabs").innerHTML = HOUSES.map((h) => `<button type="button" role="tab" data-k="${h.key}">${h.label}</button>`).join("");
  for (const b of document.querySelectorAll("#tabs button")) b.onclick = () => show(b.dataset.k);
  const k = location.hash.slice(1);
  show(HOUSES.some((h) => h.key === k) ? k : "governadores");
  $("#foot").innerHTML = `${esc(D.metodo)} Atualizado em ${new Date(D.updated).toLocaleString("pt-BR")}.`;
}
boot().catch((e) => ($("#headline").textContent = "Não consegui carregar os eleitos: " + e.message));
