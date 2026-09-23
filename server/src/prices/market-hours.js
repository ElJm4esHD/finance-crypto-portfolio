// Trading session of the Argentine market (BYMA), in Argentina time (UTC-3,
// no daylight saving). Used to avoid asking for CEDEAR/ETF prices that cannot
// have changed. Holidays are not tracked: on a holiday the app just asks once.
const ART_OFFSET_MS = -3 * 3600_000;
const DAY_MS = 86400_000;
export const SESSION = { open: '11:00', close: '17:00' };
// Quotes lag a bit behind the market: prices fetched this long after the
// close are taken as the final closing price.
const SETTLE_MS = 20 * 60_000;

const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const artMidnight = (ms) => ms - ((((ms + ART_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS);
const artWeekday = (midnight) => new Date(midnight + ART_OFFSET_MS + 12 * 3600_000).getUTCDay();
const isWeekday = (midnight) => artWeekday(midnight) >= 1 && artWeekday(midnight) <= 5;

export function isMarketOpen(ms = Date.now()) {
  const midnight = artMidnight(ms);
  const minute = (ms - midnight) / 60_000;
  return isWeekday(midnight) && minute >= minutesOf(SESSION.open) && minute < minutesOf(SESSION.close);
}

// When the last session's closing price became final (close + settle time).
export function lastSettledClose(ms = Date.now()) {
  for (let midnight = artMidnight(ms); ; midnight -= DAY_MS) {
    const settled = midnight + minutesOf(SESSION.close) * 60_000 + SETTLE_MS;
    if (isWeekday(midnight) && settled <= ms) return settled;
  }
}
