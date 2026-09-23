// Small fetch wrapper shared by the price adapters: JSON only, hard timeout,
// and an error that keeps the HTTP status so callers can tell "this symbol
// does not exist" (4xx) from "the API is down" (network, 5xx, 429).
export class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function fetchJson(url, { headers = {}, timeoutMs = 6000 } = {}) {
  let res;
  try {
    res = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    throw new HttpError(timedOut ? 'sin respuesta (timeout)' : `sin conexión (${err.cause?.code ?? err.message})`, 0);
  }
  if (!res.ok) {
    throw new HttpError(res.status === 429 ? 'límite de pedidos (HTTP 429)' : `HTTP ${res.status}`, res.status);
  }
  return res.json();
}
