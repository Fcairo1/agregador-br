// Recomputo da tendência no cliente, pro filtro de institutos / período.
// Espelha a matemática de scripts/aggregate.mjs (mesmo Kalman + house effects).
import { trendKalman } from "./kalman.js";

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

  const ratings = data.ratings || {};
  const series = {};
  for (const s of shown) series[s.key] = [];
  for (const p of polls) {
    const t = T(p.end);
    const x = xOf(t);
    const moe = p.moe || moeFromN(p.n) || 2.0;
    const rW = ratings[p.pollster]?.weight ?? 1;
    for (const s of shown) {
      const v = p.values[s.key];
      if (v == null) continue;
      series[s.key].push({ x, y: v, moeHalf: moe, t, pollster: p.pollster, n: p.n || null, ratingW: rW });
    }
  }

  const gridDaily = [];
  for (let x = 0; x <= maxX; x++) gridDaily.push(x);
  const outIdx = [];
  for (let x = 0; x <= maxX; x += P.gridStepDays) outIdx.push(x);
  if (outIdx[outIdx.length - 1] !== maxX) outIdx.push(maxX);
  const gd = outIdx.map((x) => isoOf(minEnd + x * DAY));

  const kOpts = {
    q: polls.length < (P.sparseCutoff || 25) ? 0.02 : P.q ?? 0.032,
    designEffect: P.designEffect ?? 1.6,
    z: P.z ?? 1.64,
  };

  const applyHouse = P.applyHouse && polls.length >= 20 && new Set(polls.map((p) => p.pollster)).size >= 5;
  const rawSeries = {};
  for (const s of shown) rawSeries[s.key] = series[s.key].slice();
  const house = {};
  if (applyHouse) {
    const trend0 = {};
    for (const s of shown) trend0[s.key] = trendKalman(series[s.key], gridDaily, kOpts).line;
    const at = (arr, x) => arr[Math.max(0, Math.min(arr.length - 1, Math.round(x)))];
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

  const candidates = shown
    .map((s) => {
      const pts = series[s.key];
      if (pts.length < 3) return null;
      const { line, band } = trendKalman(pts, gridDaily, kOpts);
      const L = outIdx.map((x, i) => (line[x] == null ? null : { t: gd[i], y: r2(line[x]) })).filter(Boolean);
      if (!L.length) return null;
      return {
        key: s.key,
        name: s.name,
        color: s.color,
        party: s.party,
        partyLabel: s.partyLabel,
        line: L,
        band: outIdx
          .map((x, i) => (band[x] == null ? null : { t: gd[i], lo: r2(band[x].lo), hi: r2(band[x].hi) }))
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
