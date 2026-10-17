// Servidor estático mínimo pra dev. `node scripts/serve.mjs [porta]`
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { tseProxy } from "../worker/proxy.js";
import { criarTseFalso } from "./lib/tse-mock.mjs";
import { parse26 } from "../site/apuracao/replay.js";

const ROOT = new URL("../site/", import.meta.url);
const port = +(process.argv.find((a) => /^\d+$/.test(a)) || 5173);
// --mock-tse: o /tse/* devolve um TSE falso que reproduz a ordem real de totalização do 1º turno (1 s real = 1 min simulado)
let mock = null;
if (process.argv.includes("--mock-tse")) {
  const m26 = parse26(JSON.parse(fs.readFileSync(new URL("apuracao/dados/mun-1t-2026.json", ROOT), "utf8")));
  mock = criarTseFalso(m26);
  const t0 = Date.now(), ini = Math.min(...m26.filter((m) => m.t).map((m) => Date.parse(m.t))) - 600e3;
  setInterval(() => { mock.estado.agora = ini + (Date.now() - t0) * 60; }, 250).unref();
  mock.estado.agora = ini;
  console.log("TSE falso ligado (apuração do 1º turno em 60× a velocidade)");
}
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

http
  .createServer(async (req, res) => {
    // mesmo proxy com cache do Worker (a produção usa worker/index.js)
    if (req.url.startsWith("/tse/")) {
      const r = mock ? await mock.fetchFn(req.url) : await tseProxy(new Request("http://localhost" + req.url, { method: req.method }), { cache: null });
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    const file = new URL("." + p, ROOT);
    fs.readFile(file, (err, buf) => {
      if (err) {
        res.writeHead(404);
        res.end("404");
        return;
      }
      res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" });
      res.end(buf);
    });
  })
  .listen(port, () => console.log(`http://localhost:${port}`));
