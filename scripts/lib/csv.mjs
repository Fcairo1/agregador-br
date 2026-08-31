// CSV mínimo (RFC-4180 o suficiente). Sem dependências.
import fs from "node:fs";

function enc(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows, columns) {
  const cols = columns || Object.keys(rows[0] || {});
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map((c) => enc(r[c])).join(","));
  return lines.join("\n") + "\n";
}

export function parseCSV(text) {
  const rows = [];
  let field = "";
  let row = [];
  let i = 0;
  let inQ = false;
  const pushF = () => {
    row.push(field);
    field = "";
  };
  const pushR = () => {
    pushF();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQ = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQ = true;
      i++;
      continue;
    }
    if (c === ",") {
      pushF();
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      pushR();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length || row.length) pushR();
  if (!rows.length) return [];
  const header = rows[0];
  return rows.slice(1).filter((r) => r.length && r.some((x) => x !== "")).map((r) => {
    const o = {};
    header.forEach((h, j) => (o[h] = r[j] ?? ""));
    return o;
  });
}

export function readCSV(path) {
  if (!fs.existsSync(path)) return [];
  return parseCSV(fs.readFileSync(path, "utf8"));
}

export function writeCSV(path, rows, columns) {
  fs.writeFileSync(path, toCSV(rows, columns));
}
