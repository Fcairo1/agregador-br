// fetch + aggregate
import { spawnSync } from "node:child_process";

const pass = process.argv.slice(2);
for (const step of ["fetch.mjs", "aggregate.mjs"]) {
  const r = spawnSync(process.execPath, [new URL(step, import.meta.url).pathname, ...pass], {
    stdio: "inherit",
  });
  if (r.status !== 0) process.exit(r.status || 1);
}
