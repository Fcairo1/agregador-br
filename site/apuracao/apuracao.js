// Seção "Apuração": projeção do vencedor do 2º turno enquanto o TSE totaliza (ao vivo) + replay de uma apuração histórica.
// Projeção ESTATÍSTICA independente — nunca resultado oficial. Veja CLAUDE.md ("Projeção da apuração") pro modelo e as fontes.
import { CONFIG } from "./config.js";
import { ESTADOS, REGIAO_NOME } from "./model.js";
import { MotorAoVivo, carregarReferencia, priorDePesquisa } from "./motor.js";

const SVGNS = "http://www.w3.org/2000/svg";
const $ = (root, s) => root.querySelector(s);
const el = (tag, a = {}, kids = []) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(a)) n.setAttribute(k, v);
  for (const c of [].concat(kids)) n.append(c);
  return n;
};
const txt = (s) => document.createTextNode(s);
const pct = (v, d = 1) => (v == null ? "–" : (v * 100).toFixed(d).replace(".", ",") + "%");
const num = (v) => Math.round(v).toLocaleString("pt-BR");
const fmtHora = (iso, dia = false) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: CONFIG.fusoNome, ...(dia ? { day: "2-digit", month: "2-digit" } : {}), hour: "2-digit", minute: "2-digit" });
const fmtHoraSeg = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: CONFIG.fusoNome, hour: "2-digit", minute: "2-digit", second: "2-digit" });
const A = CONFIG.A, B = CONFIG.B;
const nomeDe = (lado) => (lado === "A" ? A : B);
const probTexto = (p) => (p >= 0.9995 ? ">99,9%" : p <= 0.0005 ? "<0,1%" : pct(p, p > 0.99 || p < 0.01 ? 2 : 1));

const TEMPLATE = `
  <div class="ap">
    <div class="ap-top">
      <div>
        <h2 id="ap-titulo">${CONFIG.titulo}</h2>
        <p class="lead" id="ap-sub"></p>
      </div>
      <div class="seg" id="ap-modos" role="group" aria-label="Modo">
        <button type="button" data-m="vivo">Ao vivo</button>
        <button type="button" data-m="replay">Replay · 1º turno 2026</button>
      </div>
    </div>

    <p class="ap-aviso" role="note">Projeção estatística independente. <b>Não é um resultado oficial do TSE.</b> O resultado oficial é o do portal do TSE.</p>
    <div id="ap-conteudo"></div>
  </div>
`;

export async function mount(root) {
  root.innerHTML = TEMPLATE;
  const S = { modo: null, motor: null, replay: null, idx: 0, tocando: false, timer: null, ref: null, carga: null };
  const cont = $(root, "#ap-conteudo");

  function setModo(m) {
    S.modo = m;
    for (const b of root.querySelectorAll("#ap-modos button")) b.setAttribute("aria-pressed", String(b.dataset.m === m));
    clearInterval(S.timer); S.tocando = false;
    if (m === "vivo") iniciarVivo(); else iniciarReplay();
    try { localStorage.setItem("apuracao:modo", m); } catch (e) {}
  }
  for (const b of root.querySelectorAll("#ap-modos button")) b.onclick = () => setModo(b.dataset.m);

  // ---------- ao vivo ----------
  async function iniciarVivo() {
    S.replayAtivo = false;
    S.motor?.parar();
    const agora = Date.now(), inicio = Date.parse(CONFIG.inicio);
    $(root, "#ap-sub").textContent = `Segundo turno · ${A.nome} × ${B.nome} · começa a ser divulgado às ${fmtHora(CONFIG.inicio)} (Brasília) de ${new Date(CONFIG.inicio).toLocaleDateString("pt-BR", { timeZone: CONFIG.fusoNome })}`;
    if (!S.ref) {
      cont.innerHTML = `<p class="lead">Carregando o perfil eleitoral dos municípios…</p>`;
      try { S.ref = await carregarReferencia(); S.prior = await priorDePesquisa(); } catch (e) { cont.innerHTML = erroBox("Não consegui carregar os dados de referência: " + e.message); return; }
    }
    S.motor = new MotorAoVivo({
      ref: S.ref.ref, prior: S.prior,
      onUpdate: (u) => { S.ultimoVivo = u; desenhar({ ...u, modoVivo: true }); },
      onErro: (e, ult) => {
        console.warn("[apuração] atualização falhou:", e.message);
        if (ult) desenhar({ ...ult, resumo: ult.r, projecao: ult.pr, chamada: ult.cl, historico: S.motor.historico, modoVivo: true, desatualizado: true, erro: e.message });
        else aguardando(e.message);
      },
    });
    if (agora < inicio) { aguardando(); S.motor.historico = []; relogioEspera(inicio); return; }
    aguardando("buscando o primeiro resultado do TSE…");
    S.motor.iniciar();
  }
  function relogioEspera(inicio) {
    clearInterval(S.timer);
    S.timer = setInterval(() => {
      if (S.modo !== "vivo") return clearInterval(S.timer);
      const s = Math.max(0, Math.round((inicio - Date.now()) / 1000));
      const e = $(root, "#ap-espera"); if (e) e.textContent = contagem(s);
      if (s <= 0) { clearInterval(S.timer); iniciarVivo(); }
    }, 1000);
  }
  const contagem = (s) => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return `${d ? d + " d " : ""}${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}min ${String(s % 60).padStart(2, "0")}s`; };
  function aguardando(msg) {
    const antes = Date.now() < Date.parse(CONFIG.inicio);
    cont.innerHTML = `
      <div class="ap-banner" data-estado="inicial">
        <div class="ap-estado">${antes ? "Aguardando o início da apuração" : "Aguardando dados do TSE"}</div>
        <div class="ap-meta">${antes ? `<span id="ap-espera">${contagem(Math.max(0, Math.round((Date.parse(CONFIG.inicio) - Date.now()) / 1000)))}</span> para as ${fmtHora(CONFIG.inicio)} (Brasília)` : escapar(msg || "")}</div>
      </div>
      <p class="lead">${antes ? "Quando o TSE começar a publicar, esta página passa a se atualizar sozinha a cada minuto." : "Se o TSE demorar a publicar o primeiro arquivo, a página continua tentando com intervalo crescente (sem sobrecarregar a fonte)."}
      Enquanto isso, o <b>replay</b> mostra o modelo funcionando numa apuração real já concluída.</p>
      <p><button type="button" class="ap-btn" id="ap-ir-replay">Ver o replay do 1º turno de 2026</button></p>
      ${explicacao()}`;
    $(root, "#ap-ir-replay").onclick = () => setModo("replay");
  }

  // ---------- replay ----------
  async function iniciarReplay() {
    S.motor?.parar();
    $(root, "#ap-sub").textContent = `Replay do 1º turno de 2026 como se fosse uma disputa só entre ${A.curto} e ${B.curto} (parcela de ${A.curto} em ${A.curto}+${B.curto}). Os municípios chegam na ordem real da totalização.`;
    if (!S.replay) {
      cont.innerHTML = `<p class="lead">Carregando o replay…</p>`;
      try { S.replay = await (await fetch(CONFIG.dados.replay)).json(); } catch (e) { cont.innerHTML = erroBox("Não consegui carregar o replay: " + e.message); return; }
    }
    S.idx = Math.min(S.idx || 0, S.replay.linha.length - 1);
    if (S.idx === 0) S.idx = Math.max(0, S.replay.linha.findIndex((l) => l.contado > 0.03));
    desenhar(emReplay());
  }
  function emReplay() {
    const L = S.replay.linha, i = S.idx, l = L[i];
    const hist = L.slice(0, i + 1);
    return { modoVivo: false, replay: true, resumo: l, historico: hist, chamada: { estado: l.estado, favorito: l.favorito, prob: Math.max(l.probA, 1 - l.probA), motivo: motivoReplay(l) }, final: S.replay.metricas };
  }
  const motivoReplay = (l) => ({ inicial: "Ainda há pouco voto contado e/ou poucas regiões representadas.", aberto: "Nenhum candidato passa de 90% de probabilidade.", favorito: "Probabilidade entre 90% e 99%.", forte: "Probabilidade acima de 99%, mas faltam salvaguardas (cobertura regional, cenários conservadores ou estabilidade).", projetado: "Probabilidade acima de 99,5%, com cobertura em todas as regiões, vitória nos cenários conservadores e estabilidade.", eleito: "A vantagem em votos supera todos os votos que ainda poderiam ser computados." })[l.estado];

  // ---------- desenho ----------
  function desenhar(u) {
    const r = u.resumo, ch = u.chamada;
    const hist = (u.historico || []).map((h) => ({ ...h, pctA: h.pctA ?? (h.A + h.B > 0 ? h.A / (h.A + h.B) : null) }));
    u = { ...u, historico: hist };
    const lado = ch.favorito;
    const ult = r.parcelaA;
    const pA = r.probA, pB = 1 - pA;
    const pctOficialA = r.pctA ?? (r.A + r.B > 0 ? r.A / (r.A + r.B) : null);
    const projA = r.parcelaA ? r.parcelaA[1] : null;
    const estadoNome = ESTADOS[ch.estado];
    const frase = fraseEstado(ch, lado);
    const stale = u.desatualizado;
    const horaTxt = u.modoVivo ? fmtHoraSeg(r.t) : fmtHora(r.t, true);
    const ctrlAntigo = u.replay ? cont.querySelector(".ap-ctrl") : null; // o slider precisa sobreviver ao redesenho, senão o arraste é cortado
    cont.innerHTML = `
      <div class="ap-banner" data-estado="${ch.estado}" data-lado="${lado}">
        <div class="ap-estado">${estadoNome}${["favorito", "forte", "projetado", "eleito"].includes(ch.estado) ? ` <span class="ap-quem" style="--c:${nomeDe(lado).cor}">${nomeDe(lado).nome}</span>` : ""}</div>
        <div class="ap-meta">Última atualização do TSE: <b>${horaTxt}</b> (Brasília)${stale ? ` <span class="ap-stale" title="${escapar(u.erro || "")}">⚠ fonte indisponível — mostrando o último estado conhecido</span>` : ""}${u.replay ? ` <span class="ap-tag">replay</span>` : ""}</div>
        <p class="ap-frase">${frase}</p>
      </div>

      <div class="ap-cards">
        ${cartao(A, "A", r, pA, pctOficialA, u)}
        ${cartao(B, "B", r, pB, pctOficialA == null ? null : 1 - pctOficialA, u)}
      </div>

      <div class="ap-kpis">
        ${kpi("Urnas totalizadas", r.secoes ? pct(r.secoes[0] / r.secoes[1], 1) : "~" + pct(r.contado, 0), r.secoes ? `${num(r.secoes[0])} de ${num(r.secoes[1])} seções` : "estimado pelos votos válidos já contados")}
        ${kpi("Votos válidos contados", num(r.A + r.B), `${pct(r.contado, 1)} do esperado`)}
        ${kpi("Votos pendentes (estimativa)", "≈ " + num(r.pendentes), "ainda por entrar")}
        ${kpi("Margem final projetada", (r.margem[1] >= 0 ? A.curto : B.curto) + " +" + num(Math.abs(r.margem[1])), `90%: de ${fmtMargem(r.margem[0])} a ${fmtMargem(r.margem[2])}`)}
      </div>

      <div class="ap-graf">
        <figure>
          <figcaption>Evolução da apuração <span class="muted">— parcela de ${A.curto} no par ${A.curto}+${B.curto}</span></figcaption>
          <svg id="ap-g1" viewBox="0 0 1000 380" role="img" aria-label="Evolução da apuração e projeção"></svg>
          <div class="ap-leg">
            <span><i class="l-of"></i>oficial já contado</span>
            <span><i class="l-pr"></i>projeção do resultado final</span>
            <span><i class="l-bd"></i>intervalo de 90%</span>
            ${u.replay ? `<span><i class="l-fn"></i>resultado final</span>` : ""}
          </div>
        </figure>
        <figure>
          <figcaption>Probabilidade de vitória</figcaption>
          <svg id="ap-g2" viewBox="0 0 1000 300" role="img" aria-label="Evolução da probabilidade de vitória"></svg>
        </figure>
      </div>

      ${u.replay ? controlesReplay() : ""}

      <div class="ap-cols">
        <div>
          <h3>Onde ainda pode mudar</h3>
          <p class="lead ap-peq">Estados com mais incerteza sobre a margem final (desvio-padrão em votos) e quanto voto ainda falta neles.</p>
          ${tabelaIncerteza(r)}
        </div>
        <div>
          <h3>Cobertura por região</h3>
          <p class="lead ap-peq">Votos válidos já contados em relação ao esperado.</p>
          ${coberturaRegiao(r)}
          ${r.maxRestante != null ? `<p class="ap-peq muted">Teto de votos que ainda podem entrar (eleitores das seções não totalizadas): <b>${num(r.maxRestante)}</b>. “Matematicamente eleito” exige vantagem maior que isso.</p>` : ""}
        </div>
      </div>

      ${u.replay && u.final ? validacaoBox(u.final) : ""}
      ${explicacao()}
      ${u.modoVivo ? `<p class="ap-peq muted">Snapshots guardados neste navegador: ${(u.historico || []).length}. <button type="button" class="ap-link" id="ap-export">Exportar JSON</button></p>` : ""}
    `;
    const ctrlNovo = cont.querySelector(".ap-ctrl");
    if (ctrlAntigo && ctrlNovo) {
      ctrlNovo.replaceWith(ctrlAntigo);
      const sl = ctrlAntigo.querySelector("#ap-slider"); if (sl && +sl.value !== S.idx) sl.value = S.idx;
      ctrlAntigo.querySelector("#ap-tempo").textContent = fmtHora(S.replay.linha[S.idx].t, true);
      ctrlAntigo.querySelector("#ap-play").textContent = S.tocando ? "❚❚ Pausar" : "▶ Reproduzir";
    }
    desenharGraficos(u);
    const ex = $(root, "#ap-export"); if (ex) ex.onclick = () => baixar(S.motor.exportar());
    ligarReplay();
  }

  const cartao = (c, k, r, prob, pctOf, u) => {
    const proj = r.parcelaA ? (k === "A" ? r.parcelaA : r.parcelaA.map((v) => 1 - v).reverse()) : null;
    return `<div class="ap-card" style="--c:${c.cor}">
      <div class="ap-nome"><span class="dot" style="background:${c.cor}"></span>${c.nome} <span class="pbadge" style="--c:${c.cor}">${c.partido}</span></div>
      <div class="ap-big">${pct(pctOf, 2)}<small>oficial até agora</small></div>
      <div class="ap-linha"><span>votos</span><b>${num(k === "A" ? r.A : r.B)}</b></div>
      <div class="ap-linha"><span>probabilidade de vitória</span><b class="ap-prob">${probTexto(prob)}</b></div>
      ${proj ? `<div class="ap-linha"><span>projeção do final</span><b>${pct(proj[1], 1)} <span class="muted">(${pct(proj[0], 1)}–${pct(proj[2], 1)})</span></b></div>` : ""}
    </div>`;
  };
  const kpi = (t, v, s) => `<div class="ap-kpi"><div class="t">${t}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  const fmtMargem = (v) => (v >= 0 ? A.curto + " +" : B.curto + " +") + num(Math.abs(v));

  function fraseEstado(ch, lado) {
    const n = nomeDe(lado).nome, p = probTexto(ch.prob);
    if (ch.estado === "inicial") return `Ainda é cedo: ${ch.motivo.toLowerCase()} Os números oficiais parciais costumam mudar bastante.`;
    if (ch.estado === "aberto") return `Resultado em aberto: ${n} é o mais provável (${p}), mas ainda não passa de 90%.`;
    if (ch.estado === "favorito") return `${n} é favorito, com ${p} de probabilidade de vencer.`;
    if (ch.estado === "forte") return `Projeção forte para ${n} (${p}). ${ch.motivo.replace(/^Probabilidade[^,.]*[.,]?\s*/, "")}`;
    if (ch.estado === "projetado") return `${n} é o vencedor projetado (${p}). Ainda não é o resultado oficial.`;
    return `${n} está matematicamente eleito: a vantagem supera todos os votos que ainda poderiam ser computados.`;
  }

  // ----- gráficos -----
  function desenharGraficos(u) {
    const L = (u.historico || []).filter((h) => h.pctA != null || (h.A + h.B) > 0);
    const g1 = $(root, "#ap-g1"), g2 = $(root, "#ap-g2");
    const ts = L.map((h) => Date.parse(h.t));
    const full = u.replay ? S.replay.linha.map((h) => Date.parse(h.t)) : ts;
    let t0 = Math.min(...full, ...ts), t1 = Math.max(...full, ...ts);
    if (!u.replay) t1 = Math.max(t1, t0 + 3600e3);
    const W = 1000, M = { l: 52, r: 16, t: 14, b: 30 };
    const x = (t) => M.l + ((t - t0) / (t1 - t0 || 1)) * (W - M.l - M.r);
    const eixoX = (svg, H) => {
      const passo = (t1 - t0) > 6 * 3600e3 ? 2 : 1;
      const ini = new Date(t0); ini.setUTCMinutes(0, 0, 0);
      for (let t = ini.getTime() + 3600e3; t <= t1; t += passo * 3600e3) {
        svg.append(el("line", { class: "ap-gl", x1: x(t), x2: x(t), y1: M.t, y2: H - M.b }));
        svg.append(el("text", { class: "ap-ax", x: x(t), y: H - 10, "text-anchor": "middle" }, [txt(new Date(t).toLocaleTimeString("pt-BR", { timeZone: CONFIG.fusoNome, hour: "2-digit", minute: "2-digit" }))]));
      }
    };
    // --- g1 ---
    {
      g1.textContent = "";
      const H = 380;
      const vals = L.flatMap((h) => [h.pctA, ...(h.parcelaA || [])]).filter((v) => v != null);
      if (u.replay) vals.push(S.replay.metricas.parcelaFinalA);
      let lo = Math.min(0.46, ...vals) - 0.01, hi = Math.max(0.56, ...vals) + 0.01;
      lo = Math.floor(lo * 50) / 50; hi = Math.ceil(hi * 50) / 50;
      const y = (v) => M.t + (1 - (v - lo) / (hi - lo)) * (H - M.t - M.b);
      for (let v = Math.ceil(lo * 50) / 50; v <= hi + 1e-9; v += 0.02) {
        g1.append(el("line", { class: "ap-gl", x1: M.l, x2: W - M.r, y1: y(v), y2: y(v) }));
        g1.append(el("text", { class: "ap-ax", x: M.l - 8, y: y(v) + 4, "text-anchor": "end" }, [txt((v * 100).toFixed(0) + "%")]));
      }
      g1.append(el("line", { class: "ap-50", x1: M.l, x2: W - M.r, y1: y(0.5), y2: y(0.5) }));
      eixoX(g1, H);
      const P = L.filter((h) => h.parcelaA);
      if (P.length > 1) {
        const up = P.map((h) => `${x(Date.parse(h.t)).toFixed(1)},${y(h.parcelaA[2]).toFixed(1)}`);
        const dn = P.map((h) => `${x(Date.parse(h.t)).toFixed(1)},${y(h.parcelaA[0]).toFixed(1)}`).reverse();
        g1.append(el("polygon", { class: "ap-band", points: [...up, ...dn].join(" ") }));
        g1.append(el("polyline", { class: "ap-proj", points: P.map((h) => `${x(Date.parse(h.t)).toFixed(1)},${y(h.parcelaA[1]).toFixed(1)}`).join(" ") }));
      }
      if (u.replay) {
        const f = S.replay.metricas.parcelaFinalA;
        g1.append(el("line", { class: "ap-final", x1: M.l, x2: W - M.r, y1: y(f), y2: y(f) }));
        g1.append(el("text", { class: "ap-ax", x: W - M.r, y: y(f) - 5, "text-anchor": "end" }, [txt("resultado final " + pct(f, 2))]));
      }
      const O = L.filter((h) => h.pctA != null);
      if (O.length > 0) {
        g1.append(el("polyline", { class: "ap-of", points: O.map((h) => `${x(Date.parse(h.t)).toFixed(1)},${y(h.pctA).toFixed(1)}`).join(" ") }));
        const last = O.at(-1);
        g1.append(el("circle", { class: "ap-dot", cx: x(Date.parse(last.t)), cy: y(last.pctA), r: 5 }));
      }
      // faixa de "urnas totalizadas" no rodapé do gráfico
      const C = L.filter((h) => h.contado != null);
      if (C.length > 1) {
        const base = H - M.b;
        g1.append(el("polygon", { class: "ap-cnt", points: [`${x(Date.parse(C[0].t))},${base}`, ...C.map((h) => `${x(Date.parse(h.t)).toFixed(1)},${(base - h.contado * 38).toFixed(1)}`), `${x(Date.parse(C.at(-1).t))},${base}`].join(" ") }));
      }
      sobrepor(g1, H, x, y, L, (h) => `${fmtHora(h.t)} · oficial ${pct(h.pctA)} · projeção ${pct(h.parcelaA?.[1])} · ${pct(h.contado, 0)} contado`);
    }
    // --- g2 ---
    {
      g2.textContent = "";
      const H = 300;
      const y = (p) => M.t + (1 - p) * (H - M.t - M.b);
      for (const [p, nome] of [[0, "0%"], [0.5, "50%"], [0.9, "90%"], [1, "100%"]]) {
        g2.append(el("line", { class: p === 0.5 ? "ap-50" : "ap-gl", x1: M.l, x2: W - M.r, y1: y(p), y2: y(p) }));
        g2.append(el("text", { class: "ap-ax", x: M.l - 8, y: y(p) + 4, "text-anchor": "end" }, [txt(nome)]));
      }
      g2.append(el("line", { class: "ap-gl ap-tracejado", x1: M.l, x2: W - M.r, y1: y(0.995), y2: y(0.995) }));
      g2.append(el("text", { class: "ap-ax", x: W - M.r - 2, y: y(0.995) - 4, "text-anchor": "end" }, [txt("99,5%: limite pra “vencedor projetado”")]));
      eixoX(g2, H);
      // faixa colorida do estado (rodapé)
      const COR = { inicial: "var(--muted)", aberto: "#d19a2a", favorito: "#4b7bd4", forte: "#2f9e8f", projetado: "#1f9d57", eleito: "#0b7a3b" };
      for (let i = 0; i < L.length; i++) {
        const a = Date.parse(L[i].t), b = i + 1 < L.length ? Date.parse(L[i + 1].t) : a + 5 * 60e3;
        g2.append(el("rect", { x: x(a), y: H - M.b + 2, width: Math.max(1, x(b) - x(a)), height: 6, fill: COR[L[i].estado], opacity: 0.9 }));
      }
      if (L.length > 1) {
        g2.append(el("polyline", { class: "ap-pA", points: L.map((h) => `${x(Date.parse(h.t)).toFixed(1)},${y(h.probA).toFixed(1)}`).join(" "), stroke: A.cor }));
        g2.append(el("polyline", { class: "ap-pB", points: L.map((h) => `${x(Date.parse(h.t)).toFixed(1)},${y(1 - h.probA).toFixed(1)}`).join(" "), stroke: B.cor }));
        const last = L.at(-1);
        g2.append(el("text", { class: "ap-lbl", x: x(Date.parse(last.t)) - 6, y: y(last.probA) + (last.probA > 0.5 ? -8 : 16), "text-anchor": "end", fill: A.cor }, [txt(`${A.curto} ${probTexto(last.probA)}`)]));
        g2.append(el("text", { class: "ap-lbl", x: x(Date.parse(last.t)) - 6, y: y(1 - last.probA) + (1 - last.probA > 0.5 ? -8 : 16), "text-anchor": "end", fill: B.cor }, [txt(`${B.curto} ${probTexto(1 - last.probA)}`)]));
      }
      sobrepor(g2, H, x, y, L, (h) => `${fmtHora(h.t)} · ${A.curto} ${probTexto(h.probA)} · ${ESTADOS[h.estado]}`);
    }
  }
  // dica de passagem do mouse (<title>) em colunas finas
  function sobrepor(svg, H, x, y, L, fmt) {
    const g = el("g");
    for (let i = 0; i < L.length; i++) {
      const a = Date.parse(L[i].t), b = i + 1 < L.length ? Date.parse(L[i + 1].t) : a + 5 * 60e3;
      const r = el("rect", { x: x(a), y: 0, width: Math.max(2, x(b) - x(a)), height: H, fill: "transparent" });
      r.append(el("title", {}, [txt(fmt(L[i]))]));
      g.append(r);
    }
    svg.append(g);
  }

  const tabelaIncerteza = (r) => {
    const top = (r.topIncerteza || []).slice(0, 6);
    if (!top.length) return `<p class="ap-peq muted">Sem municípios pendentes.</p>`;
    const max = Math.max(...top.map((t) => t.sd), 1);
    return `<table class="bt-tbl ap-tab"><thead><tr><th>UF</th><th>Região</th><th>Pendentes</th><th>Margem esperada</th><th>Incerteza (±1 dp)</th></tr></thead><tbody>${top
      .map((t) => `<tr><td><b>${t.uf.toUpperCase()}</b></td><td>${REGIAO_NOME[t.regiao] || t.regiao}</td><td>${num(t.pendentes)}</td><td>${fmtMargem(t.margemEsperada)}</td><td><div class="ap-barra"><i style="width:${(t.sd / max) * 100}%"></i></div><span class="muted">${num(t.sd)}</span></td></tr>`)
      .join("")}</tbody></table>`;
  };
  const coberturaRegiao = (r) =>
    `<div class="ap-cob">${["N", "NE", "CO", "SE", "S"].map((g) => `<div><span>${REGIAO_NOME[g]}</span><div class="ap-barra"><i style="width:${(r.cobertura?.[g] || 0) * 100}%"></i></div><b>${pct(r.cobertura?.[g] || 0, 0)}</b></div>`).join("")}</div>`;

  const validacaoBox = (m) => `
    <div class="ap-valid">
      <h3>Como o modelo se saiu neste replay</h3>
      <ul>
        <li><b>Primeira “favorito” (≥90%):</b> ${m.primeiroFavorito ? `${fmtHora(m.primeiroFavorito.t, true)} com ${pct(m.primeiroFavorito.contado, 0)} contado (${pct(m.primeiroFavorito.prob, 1)})` : "—"}</li>
        <li><b>Primeira projeção de vencedor:</b> ${m.primeiraProjecao ? `${fmtHora(m.primeiraProjecao.t, true)} com ${pct(m.primeiraProjecao.contado, 0)} contado e ${probTexto(m.primeiraProjecao.prob)} de probabilidade` : "nenhuma"}</li>
        <li><b>Erro da projeção final:</b> ${((m.erroFinal) * 100).toFixed(2).replace(".", ",")} p.p. · <b>erro médio ao longo da apuração:</b> ${(m.erroMedioProjecao * 100).toFixed(1).replace(".", ",")} p.p. (a % nacional parcial errava ${(m.erroMedioIngenuo * 100).toFixed(1).replace(".", ",")} p.p.)</li>
        <li><b>Intervalo de 90% continha o resultado final</b> em ${pct(m.cobertura90, 0)} das atualizações (meta: ~90%).</li>
        <li><b>Chamadas erradas ou revertidas:</b> ${m.chamadasErradas} ${m.reversoes ? "· houve reversão ⚠" : "· nenhuma reversão"}</li>
      </ul>
      <p class="ap-peq muted">Teste de estresse com dados reais: a ordem de chegada do 1º turno de 2026 trouxe Flávio com ~61% do par no começo e ~51% no fim. O modelo corrige esse viés geográfico olhando <i>de onde</i> vieram os votos e <i>quais municípios faltam</i>. O 2º turno de 2022 não pôde ser reproduzido: os horários de chegada de 2022 não estão em formato estruturado.</p>
    </div>`;

  const explicacao = () => `
    <details class="ap-expl" ${S.modo === "vivo" ? "" : "open"}>
      <summary>Por que a porcentagem muda durante a apuração?</summary>
      <p>As urnas não chegam em ordem aleatória. Cidades pequenas, estados com urna eletrônica de transmissão mais rápida e regiões com menos seções terminam antes; capitais e grandes colégios terminam depois. Por isso a porcentagem nacional parcial mostra o perfil de <i>quem já foi contado</i>, não de todo o Brasil.</p>
      <p>No 1º turno de 2026, por exemplo, Flávio começou com cerca de 61% do par Flávio+Lula e terminou em 51%: os votos que faltavam eram de lugares mais favoráveis a Lula. A projeção estima, município a município, <b>quanto voto ainda falta e quem tende a receber</b>, usando o resultado do 1º turno, a eleição de 2022, o comportamento já observado nos municípios totalizados e a incerteza sobre comparecimento e transferência de votos.</p>
      <p><b>Como o modelo funciona.</b> Para cada município, estima-se a parcela de ${A.curto} a partir do perfil eleitoral dele (1º turno 2026, 2º turno 2022, peso dos candidatos eliminados), ajustando em tempo real com os municípios já totalizados. Quando há poucos dados, a estimativa “recua” para o padrão do estado, da região e do país. Depois são feitos milhares de sorteios do voto restante, com incerteza de comparecimento, transferência de votos, brancos e nulos, variação regional e correlação entre cidades parecidas. Pesquisas servem só de ponto de partida fraco e perdem peso rapidamente conforme os votos reais entram.</p>
      <p><b>Quando a chamada é feita.</b> “Favorito”: 90–99% · “Projeção forte”: 99–99,5% · “Vencedor projetado”: acima de 99,5%, com cobertura mínima em todas as regiões, vitória nos cenários conservadores sobre as urnas restantes e estabilidade em atualizações seguidas · “Matematicamente eleito”: a vantagem supera todos os votos que ainda poderiam entrar. Se a fonte oficial atrasar, a página mostra o último estado conhecido e o horário dele — ausência de dados nunca aumenta a confiança.</p>
    </details>`;

  // ----- controles do replay -----
  function controlesReplay() {
    const n = S.replay.linha.length;
    return `<div class="ap-ctrl">
      <button type="button" class="ap-btn" id="ap-play">${S.tocando ? "❚❚ Pausar" : "▶ Reproduzir"}</button>
      <input type="range" id="ap-slider" min="0" max="${n - 1}" value="${S.idx}" aria-label="Momento da apuração" />
      <span id="ap-tempo" class="muted">${fmtHora(S.replay.linha[S.idx].t, true)}</span>
      <label class="ap-vel">velocidade <select id="ap-vel"><option value="900">1×</option><option value="450" selected>2×</option><option value="200">4×</option><option value="80">10×</option></select></label>
    </div>`;
  }
  function ligarReplay() {
    const sl = $(root, "#ap-slider");
    if (!sl) return;
    sl.oninput = () => { S.idx = +sl.value; pausar(); desenhar(emReplay()); };
    $(root, "#ap-play").onclick = () => { S.tocando ? pausar() : tocar(); };
    const v = $(root, "#ap-vel"); v.value = S.vel || "450"; v.onchange = () => { S.vel = v.value; if (S.tocando) { pausar(); tocar(); } };
  }
  function tocar() {
    if (S.idx >= S.replay.linha.length - 1) S.idx = Math.max(0, S.replay.linha.findIndex((l) => l.contado > 0.03));
    S.tocando = true;
    clearInterval(S.timer);
    S.timer = setInterval(() => {
      if (S.modo !== "replay") return clearInterval(S.timer);
      if (S.idx >= S.replay.linha.length - 1) return pausar();
      S.idx++;
      desenhar(emReplay());
    }, +(S.vel || 450));
    desenhar(emReplay());
  }
  function pausar() { S.tocando = false; clearInterval(S.timer); const b = $(root, "#ap-play"); if (b) b.textContent = "▶ Reproduzir"; }

  // ----- utilidades -----
  const escapar = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const erroBox = (m) => `<p class="lead err-big">${escapar(m)}</p>`;
  function baixar(json) {
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `apuracao-2t-2026-snapshots.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // modo inicial: ao vivo (a partir do início da apuração) ou o último escolhido; antes do início, o replay é o mais útil
  let m0 = "vivo";
  try { m0 = localStorage.getItem("apuracao:modo") || (Date.now() < Date.parse(CONFIG.inicio) ? "replay" : "vivo"); } catch (e) {}
  setModo(m0);
}
