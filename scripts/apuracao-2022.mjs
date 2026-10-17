// Presidente 2022 por município (1º e 2º turno) a partir do arquivo oficial de votação por seção (TSE Dados Abertos).
// Serve de covariável do modelo (comportamento eleitoral anterior da localidade) e de base do replay do 1º turno de 2026.
// Streaming: o CSV tem ~1,6 GB descompactado; nada disso vai pro repo — só o agregado por município (~300 KB).
// Uso: node scripts/apuracao-2022.mjs <caminho do votacao_secao_2022_BR.zip>
import fs from "node:fs";
import zlib from "node:zlib";
import readline from "node:readline";

const zip = process.argv[2];
if (!zip) {
  console.error("uso: node scripts/apuracao-2022.mjs votacao_secao_2022_BR.zip  (https://cdn.tse.jus.br/estatistica/sead/odsele/votacao_secao/votacao_secao_2022_BR.zip)");
  process.exit(1);
}
const OUT = new URL("../site/apuracao/dados/mun-2022.json", import.meta.url);

// 1ª entrada do zip (sem depender de ler o arquivo todo): cabeçalho local
const fd = fs.openSync(zip, "r");
const head = Buffer.alloc(30);
fs.readSync(fd, head, 0, 30, 0);
if (head.readUInt32LE(0) !== 0x04034b50) throw new Error("zip inválido");
const nlen = head.readUInt16LE(26), elen = head.readUInt16LE(28);
const csize = fs.statSync(zip).size;
// tamanho comprimido da 1ª entrada via diretório central (fim do arquivo)
const tail = Buffer.alloc(Math.min(70000, csize));
fs.readSync(fd, tail, 0, tail.length, csize - tail.length);
const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
const cdOff = tail.readUInt32LE(eocd + 16) - (csize - tail.length);
const entryCsize = tail.readUInt32LE(cdOff + 20);
const start = 30 + nlen + elen;
fs.closeSync(fd);

const stream = fs.createReadStream(zip, { start, end: start + entryCsize - 1 }).pipe(zlib.createInflateRaw());
const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

const agg = new Map(); // "turno|uf|cd" -> { l13, b22, blank, nulo }
let header = null, idx = {}, n = 0;
for await (const raw of rl) {
  const line = Buffer.from(raw, "latin1").toString("latin1");
  const c = line.split(";").map((x) => x.replace(/^"|"$/g, ""));
  if (!header) {
    header = c;
    idx = Object.fromEntries(header.map((h, i) => [h, i]));
    continue;
  }
  const turno = c[idx.NR_TURNO], uf = c[idx.SG_UF].toLowerCase(), cd = c[idx.CD_MUNICIPIO].padStart(5, "0");
  const key = `${turno}|${uf}|${cd}`;
  let a = agg.get(key);
  if (!a) agg.set(key, (a = { lula: 0, bolso: 0, blank: 0, nulo: 0, outros: 0 }));
  const v = +c[idx.QT_VOTOS] || 0, num = c[idx.NR_VOTAVEL];
  if (num === "13") a.lula += v;
  else if (num === "22") a.bolso += v;
  else if (num === "95") a.blank += v;
  else if (num === "96") a.nulo += v;
  else a.outros += v;
  if (++n % 2000000 === 0) console.log(`  ${(n / 1e6).toFixed(0)} M linhas…`);
}
const rows = [];
for (const [k, a] of agg) {
  const [turno, uf, cd] = k.split("|");
  rows.push([+turno, uf, cd, a.lula, a.bolso, a.outros, a.blank, a.nulo]);
}
rows.sort((x, y) => x[0] - y[0] || (x[1] + x[2]).localeCompare(y[1] + y[2]));
fs.writeFileSync(OUT, JSON.stringify({ fonte: "TSE Dados Abertos — votacao_secao_2022_BR (presidente)", cols: ["turno", "uf", "cd", "lula", "bolsonaro", "outros", "brancos", "nulos"], rows }));
const t2 = rows.filter((r) => r[0] === 2).reduce((s, r) => ({ l: s.l + r[3], b: s.b + r[4] }), { l: 0, b: 0 });
console.log(`-> ${rows.length} linhas (${n} linhas lidas) · 2T 2022: Lula ${t2.l} (${((t2.l / (t2.l + t2.b)) * 100).toFixed(2)}%) × Bolsonaro ${t2.b}`);
