// Cloudflare Worker: serve os arquivos estáticos de ./site (binding de assets) e o proxy /tse/* com cache.
import { tseProxy } from "./proxy.js";

export default {
  async fetch(request, env, ctx) {
    const u = new URL(request.url);
    if (u.pathname.startsWith("/tse/")) return tseProxy(request, { cache: caches.default, waitUntil: (p) => ctx.waitUntil(p) });
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response("not found", { status: 404 });
  },
};
