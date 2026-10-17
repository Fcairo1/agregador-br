// Proxy com cache para os JSONs oficiais do TSE (o portal não libera CORS e não queremos que cada visitante bata nele).
// Isomórfico: usa caches.default no Cloudflare Worker e um Map em memória no Node (scripts/serve.mjs).
//  - só repassa caminhos conhecidos (allowlist) e só GET
//  - cache curto (30 s) pros arquivos que mudam durante a apuração; longo (6 h) pros municípios já finalizados (?f=1)
//  - em erro do TSE devolve a última cópia boa (stale-if-error) com cabeçalho x-stale
const BASE = "https://resultados.tse.jus.br/oficial/ele2026/";
const OK = /^(6257|6258)\/(dados\/[a-z]{2}\/[a-z]{2}\d{0,5}-(c0001-)?e00(6257|6258)-(u|ab)\.json|config\/mun-e00(6257|6258)-cm\.json)$/;
const TTL_CURTO = 30, TTL_LONGO = 6 * 3600, TTL_404 = 20;
const mem = new Map();

export async function tseProxy(request, { cache = globalThis.caches?.default, waitUntil = () => {} } = {}) {
  const u = new URL(request.url);
  if (request.method !== "GET") return new Response("método não permitido", { status: 405 });
  const rel = u.pathname.replace(/^\/tse\//, "");
  if (!OK.test(rel)) return new Response("caminho não permitido", { status: 400 });
  const longo = u.searchParams.get("f") === "1";
  const ttl = longo ? TTL_LONGO : TTL_CURTO;
  const chave = new Request(BASE + rel, { method: "GET" });

  // cache hit
  if (cache) {
    const hit = await cache.match(chave);
    if (hit) return com(hit, "HIT");
  } else {
    const m = mem.get(rel);
    if (m && Date.now() - m.at < m.ttl * 1000) return new Response(m.body, { status: m.status, headers: cabecalhos(m.status, m.ttl, "HIT") });
  }
  try {
    const r = await fetch(BASE + rel, { headers: { "user-agent": "Mozilla/5.0 (agregador-br; proxy com cache)" } });
    if (r.status === 404) {
      guardar(rel, chave, "", 404, TTL_404, cache, waitUntil);
      return new Response("não publicado", { status: 404, headers: cabecalhos(404, TTL_404, "MISS") });
    }
    if (!r.ok) throw new Error("HTTP " + r.status);
    const body = await r.text();
    guardar(rel, chave, body, 200, ttl, cache, waitUntil);
    return new Response(body, { status: 200, headers: cabecalhos(200, ttl, "MISS") });
  } catch (e) {
    // TSE fora do ar / mudou: devolve a última cópia conhecida (mesmo vencida) em vez de derrubar a interface
    const velho = cache ? await cache.match(new Request(BASE + rel + "#stale")) : mem.get(rel + "#stale");
    if (velho) return cache ? com(velho, "STALE") : new Response(velho.body, { status: 200, headers: cabecalhos(200, 5, "STALE") });
    return new Response("TSE indisponível: " + e.message, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
function cabecalhos(status, ttl, x) {
  return { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${Math.min(ttl, 30)}`, "access-control-allow-origin": "*", "x-cache": x, ...(x === "STALE" ? { "x-stale": "1" } : {}) };
}
function com(resp, x) {
  const h = new Headers(resp.headers);
  h.set("x-cache", x);
  if (x === "STALE") h.set("x-stale", "1");
  return new Response(resp.body, { status: resp.status, headers: h });
}
function guardar(rel, chave, body, status, ttl, cache, waitUntil) {
  if (cache) {
    waitUntil(cache.put(chave, new Response(body, { status, headers: { ...cabecalhos(status, ttl, "MISS"), "cache-control": `public, max-age=${ttl}` } })));
    if (status === 200) waitUntil(cache.put(new Request(BASE + rel + "#stale"), new Response(body, { headers: { "cache-control": "public, max-age=86400", "content-type": "application/json" } })));
  } else {
    mem.set(rel, { body, status, ttl, at: Date.now() });
    if (status === 200) mem.set(rel + "#stale", { body, status, ttl: 86400, at: Date.now() });
  }
}
