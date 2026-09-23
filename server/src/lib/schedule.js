// Daily jobs at a fixed local time (process TZ, America/Argentina/Buenos_Aires
// in Docker). `days` limits them to some weekdays (0 = Sunday).

const parse = (at) => [Number(at.slice(0, 2)), Number(at.slice(3, 5))];

// Most recent scheduled time at or before `now` (null if none in the last week).
export function lastRun(now, at, days = null) {
  const [h, m] = parse(at);
  for (let back = 0; back <= 7; back++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, h, m);
    if (d <= now && (!days || days.includes(d.getDay()))) return d;
  }
  return null;
}

// Next scheduled time strictly after `now`.
export function nextRun(now, at, days = null) {
  const [h, m] = parse(at);
  for (let ahead = 0; ahead <= 7; ahead++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ahead, h, m);
    if (d > now && (!days || days.includes(d.getDay()))) return d;
  }
  throw new Error(`Horario inválido: ${at}`);
}

// Runs `job` every day at `at` ("HH:MM"). Returns a function that cancels it.
export function scheduleDaily({ at, days = null, job, log = console }) {
  let timer;
  let after = new Date();
  const plan = () => {
    const next = nextRun(after, at, days);
    after = next; // never run the same slot twice, even if the timer fires early
    timer = setTimeout(async () => {
      try {
        await job();
      } catch (err) {
        log.error(`[agenda] ${at}: ${err.message}`);
      }
      plan();
    }, Math.max(next - Date.now(), 0));
  };
  plan();
  return () => clearTimeout(timer);
}

export const WEEKDAYS = [1, 2, 3, 4, 5];
