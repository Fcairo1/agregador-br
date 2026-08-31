// Recomputo da tendência no cliente, pro filtro de institutos.
// Espelha a matemática de scripts/aggregate.mjs (mesmo LOESS + house effects).
import { loess, loessWithBand, mulberry32 } from "./loess.js";

const DAY = 86400000;
const T = (iso) => new Date(iso + "T00:00:00Z").getTime();
const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
const moeFromN = (n) => (!n || n <= 0 ? null : Math.round((98 / Math.sqrt(n)) * 10) / 10);

export function recompute(data, { excluded = new Set(), sinceDays = null } = {}) {
  const P = data.params;
  const shown = data.shown;
  const fullMaxEnd = Math.max(...data.polls.map((p) => T(p.end)));
  const cutoff = sinceDays ? fullMaxEnd - sinceDays * DAY : -Infinity;
  const polls = data.polls.filter((p) => !excluded.has(p.pollster) && T(p.end) >= cutoff);
  if (polls.length < 3) return { candidates: [], nPolls: polls.length, pollsters: [], empty: true };

  const ends = polls.map((p) => T(p.end));
  const minEnd = Math.min(...ends);
  const maxEnd = Math.max(...ends);
  const xOf = (t) => Math.round((t - minEnd) / DAY);
  const maxX = xOf(maxEnd);

  const series = {};
  for (const s of shown) series[s.key] = [];
  for (const p of polls) {
    const t = T(p.end);
    const x = xOf(t);
    const age = (maxEnd - t) / DAY;
    const base = Math.pow(0.5, age / P.halflifeDays) * (p.n ? clamp(Math.sqrt(p.n / 1000), 0.5, 2) : 1);
    const moe = p.moe || moeFromN(p.n) || 2.0;
    for (const s of shown) {
      const v = p.values[s.key];
      if (v == null) continue;
      series[s.key].push({ x, y: v, base, moeHalf: moe, t, pollster: p.pollster, n: p.n || null });
    }
  }

  const grid = [];
  for (let x = 0; x <= maxX; x += P.gridStepDays) grid.push(x);
  if (grid[grid.length - 1] !== maxX) grid.push(maxX);
  const gd = grid.map((x) => isoOf(minEnd + x * DAY));

  const sparse = polls.length < P.sparseCutoff;
  const lo = {
    span: sparse ? 0.6 : P.span,
    minPts: P.minPts,
    minBandwidthX: sparse ? 26 : 14,
    maxGapX: sparse ? 40 : 30,
  };

  const applyHouse = P.applyHouse && polls.length >= 20 && new Set(polls.map((p) => p.pollster)).size >= 5;
  const rawSeries = {};
  for (const s of shown) rawSeries[s.key] = series[s.key].slice();
  const house = {};
  if (applyHouse) {
    const trend0 = {};
    for (const s of shown) trend0[s.key] = loess(series[s.key], grid, lo);
    const at = (arr, x) => {
      const g = x / P.gridStepDays;
      const a = Math.floor(g);
      const b = Math.ceil(g);
      if (a < 0 || b >= arr.length) return null;
      const va = arr[a];
      const vb = arr[b];
      if (va == null || vb == null) return va ?? vb;
      return va + (vb - va) * (g - a);
    };
    const raw = {};
    for (const s of shown)
      for (const p of series[s.key]) {
        const tv = at(trend0[s.key], p.x);
        if (tv == null) continue;
        ((raw[p.pollster] ??= {})[s.key] ??= []).push(p.y - tv);
      }
    for (const [pst, byK] of Object.entries(raw)) {
      house[pst] = {};
      for (const [k, rs] of Object.entries(byK)) {
        const m = rs.reduce((a, v) => a + v, 0) / rs.length;
        house[pst][k] = clamp(m * (rs.length / (rs.length + 5)), -P.houseMaxShift, P.houseMaxShift);
      }
    }
    for (const s of shown)
      series[s.key] = series[s.key].map((p) => ({ ...p, y: p.y - (house[p.pollster]?.[s.key] || 0) }));
  }

  const rng = mulberry32(P.seed);
  const candidates = shown
    .map((s) => {
      const pts = series[s.key];
      if (pts.length < 3) return null;
      const { line, band } = loessWithBand(pts, grid, {
        ...lo,
        bootstrap: Math.min(P.bootstrap, 160),
        bandLo: P.bandLo,
        bandHi: P.bandHi,
        rng,
      });
      const L = gd.map((t, i) => (line[i] == null ? null : { t, y: r2(line[i]) })).filter(Boolean);
      if (!L.length) return null;
      return {
        key: s.key,
        name: s.name,
        color: s.color,
        party: s.party,
        partyLabel: s.partyLabel,
        line: L,
        band: gd
          .map((t, i) => (band[i] == null ? null : { t, lo: r2(band[i].lo), hi: r2(band[i].hi) }))
          .filter(Boolean),
        polls: rawSeries[s.key]
          .slice()
          .sort((a, b) => a.t - b.t)
          .map((p) => ({ t: isoOf(p.t), y: r2(p.y), pollster: p.pollster, n: p.n })),
      };
    })
    .filter(Boolean);

  return {
    candidates,
    xDomain: [isoOf(minEnd), isoOf(maxEnd)],
    nPolls: polls.length,
    lastPoll: isoOf(maxEnd),
    pollsters: [...new Set(polls.map((p) => p.pollster))].sort(),
  };
}
