// Motor ao vivo: a cada ciclo busca o snapshot do TSE (adapter), projeta (model) e classifica a chamada (com estabilidade).
// Guarda um resumo de cada atualização (auditoria/reprodução) e tolera fonte indisponível sem aumentar a confiança.
import { CONFIG } from "./config.js";
import { project, classificar } from "./model.js";
import { parse26, parse22, makeRef } from "./replay.js";
import { TseClient } from "./adapter.js";

const CHAVE = "apuracao:2026-2t:snapshots";

export async function carregarReferencia(base = "") {
  const get = async (rel) => (await fetch(base + rel)).json();
  const [d26, d22] = await Promise.all([get(CONFIG.dados.mun1t), get(CONFIG.dados.mun2022)]);
  const m26 = parse26(d26), m22 = parse22(d22);
  return { m26, m22, ref: makeRef(m26, m22, "ao-vivo") };
}

/** prior fraco: tendência final das pesquisas de 2º turno, no par A/(A+B) */
export async function priorDePesquisa(base = "") {
  try {
    const d = await (await fetch(base + CONFIG.dados.pesquisa)).json();
    const last = (key) => d.candidates.find((c) => c.key === key)?.line.at(-1)?.y;
    const a = last(CONFIG.A.id), b = last(CONFIG.B.id);
    if (a && b) return { share: a / (a + b), sd: 0.03, data: d.lastPoll };
  } catch (e) { /* sem prior: o modelo roda só com os dados da apuração */ }
  return null;
}

export class MotorAoVivo {
  constructor({ ref, prior, client = new TseClient(), onUpdate = () => {}, onErro = () => {}, S = 2000, storage = globalThis.localStorage, features = ["z", "z2", "e"], ratio0 = 1.0 } = {}) {
    Object.assign(this, { ref, prior, client, onUpdate, onErro, S, storage, features, ratio0 });
    this.historico = this.carregar();
    this.timer = null;
    this.rodando = false;
    this.ultimoOk = null;
  }
  carregar() {
    try { return JSON.parse(this.storage?.getItem(CHAVE) || "[]"); } catch { return []; }
  }
  guardar() {
    try { this.storage?.setItem(CHAVE, JSON.stringify(this.historico.slice(-CONFIG.maxSnapshotsGuardados))); } catch { /* cota cheia: segue sem persistir */ }
  }
  /** resumo guardado por atualização (suficiente pra reproduzir os gráficos e auditar) */
  static resumir(pr, cl, snap) {
    return {
      t: pr.t, buscadoEm: snap.buscadoEm, A: pr.A, B: pr.B, contado: pr.contado, secoes: [snap.nacional.secoesTotalizadas, snap.nacional.secoes],
      probA: pr.probA, parcelaA: [pr.parcelaA.lo, pr.parcelaA.media, pr.parcelaA.hi], margem: [pr.margem.lo, pr.margem.mediana, pr.margem.hi],
      estado: cl.estado, favorito: cl.favorito, prob: cl.prob, motivo: cl.motivo, cobertura: pr.cobertura, topIncerteza: pr.incerteza.slice(0, 6),
      pendentes: pr.pendentes, maxRestante: pr.maxRestante, estresse: pr.estresse, params: pr.params, mun: pr.municipiosObservados,
    };
  }
  async ciclo() {
    try {
      const snap = await this.client.snapshot();
      const pr = project(snap, { ref: this.ref, features: this.features, prior: this.prior, S: this.S, expectedRatio0: this.ratio0 });
      const cl = classificar(pr, this.historico);
      const r = MotorAoVivo.resumir(pr, cl, snap);
      // só registra se o TSE realmente atualizou (mesmo horário = mesma foto)
      if (!this.historico.length || this.historico.at(-1).t !== r.t) { this.historico.push(r); this.guardar(); }
      this.ultimoOk = { r, pr, cl, snap, em: Date.now() };
      this.onUpdate({ resumo: r, projecao: pr, chamada: cl, historico: this.historico, desatualizado: false });
    } catch (e) {
      // fonte indisponível/mudou: mantém o último estado conhecido e AVISA (ausência de dado não vira confiança)
      this.client.falhas++;
      this.onErro(e, this.ultimoOk);
    }
  }
  iniciar() {
    if (this.rodando) return;
    this.rodando = true;
    const laco = async () => {
      if (!this.rodando) return;
      if (!document.hidden) await this.ciclo();
      const atraso = CONFIG.intervaloMs * Math.min(4, 1 + this.client.falhas); // backoff quando falha
      this.timer = setTimeout(laco, atraso);
    };
    laco();
  }
  parar() { this.rodando = false; clearTimeout(this.timer); }
  exportar() {
    return JSON.stringify({ gerado: new Date().toISOString(), fonte: "TSE (resultados.tse.jus.br) — projeção estatística independente", snapshots: this.historico }, null, 1);
  }
}
