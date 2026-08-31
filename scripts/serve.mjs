// Servidor estático mínimo pra dev. `node scripts/serve.mjs [porta]`
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("../site/", import.meta.url);
const port = +(process.argv[2] || 5173);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

http
  .createServer((req, res) => {
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
