import { useSyncExternalStore } from 'react';

export interface Route {
  path: string[];
  query: URLSearchParams;
}

function parse(): Route {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [p, q = ''] = raw.split('?');
  return { path: p.split('/').filter(Boolean), query: new URLSearchParams(q) };
}

let cached = parse();
let lastHash = location.hash;
function snapshot() {
  if (location.hash !== lastHash) {
    lastHash = location.hash;
    cached = parse();
  }
  return cached;
}
function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

export const useRoute = () => useSyncExternalStore(subscribe, snapshot);
export const go = (path: string, replace = false) => {
  if (replace) location.replace(`#${path}`);
  else location.hash = path;
};
export const back = () => history.back();
