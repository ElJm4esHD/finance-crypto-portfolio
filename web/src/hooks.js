import { createContext } from 'preact';
import { useContext, useEffect, useState, useCallback } from 'preact/hooks';
import { api } from './api.js';

// Bumped after every change so every view on screen refetches its data.
export const DataVersion = createContext({ version: 0, bump: () => {} });

export function useDataVersion() {
  return useContext(DataVersion);
}

// GET a resource; keeps showing the previous data while refetching.
export function useApi(path) {
  const { version } = useDataVersion();
  const [state, setState] = useState({ data: null, error: null, loading: true });
  useEffect(() => {
    let alive = true;
    api.get(path).then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (err) => alive && setState((s) => ({ ...s, error: err.message, loading: false })),
    );
    return () => {
      alive = false;
    };
  }, [path, version]);
  return state;
}

// Runs a mutation, tracks busy/error state and refreshes all data on success.
export function useMutation() {
  const { bump } = useDataVersion();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = useCallback(
    async (fn) => {
      setBusy(true);
      setError(null);
      try {
        const result = await fn();
        bump();
        return { ok: true, result };
      } catch (err) {
        setError(err.message);
        return { ok: false };
      } finally {
        setBusy(false);
      }
    },
    [bump],
  );
  return { run, busy, error, setError };
}

// Hash routing: "#/cripto/holdings" → ["cripto", "holdings"].
export function useHashRoute() {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const onChange = () => setParts(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return parts;
}

export const navigate = (path) => {
  window.location.hash = `#/${path}`;
};

// useState remembered in this browser (e.g. the currency picked in each
// section). Falls back to plain state when storage is not available.
export function useStoredState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem(key)) ?? initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v) => {
      setValue(v);
      try {
        window.localStorage.setItem(key, JSON.stringify(v));
      } catch {
        // private mode or storage blocked: keep it for this visit only
      }
    },
    [key],
  );
  return [value, set];
}
