// Helpers for deterministic fake prices: same asset + same day → same price,
// with a smooth drift across days so charts and returns look realistic.

export function hash(str) {
  let h = 2166136261;
  for (const ch of str) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295; // 0..1
}

export const yesterday = () => new Date(Date.now() - 86400000);

// Multiplier around 1.0 (roughly 0.85–1.25) that changes slowly day by day.
export function dailyDrift(seed, date = new Date()) {
  const day = Math.floor(date.getTime() / 86400000);
  const phase = hash(seed) * Math.PI * 2;
  return 1.05 + 0.12 * Math.sin(day / 9 + phase) + 0.03 * Math.sin(day / 2.3 + phase * 2);
}
