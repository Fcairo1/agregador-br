// fetch + (ratings, best-effort) + aggregate
import { spawnSync } from "node:child_process";

const pass = process.argv.slice(2);
const run = (step) =>
  spawnSync(process.execPath, [new URL(step, import.meta.url).pathname, ...pass], { stdio: "inherit" }).status;

if (run("fetch.mjs") !== 0) process.exit(1);

// ratings histórico (2018/22): não deve derrubar o build se a Wikipédia falhar
if (run("ratings.mjs") !== 0) console.warn("ratings.mjs falhou — usando ratings.json anterior (se houver)");

if (run("aggregate.mjs") !== 0) process.exit(1);
