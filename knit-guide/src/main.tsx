import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { autoSnapshot } from './storage/backup';
import { initStore, installLifecycleFlush, repo, useStore } from './store/store';
import './theme.css';
import './styles.css';

registerSW({ immediate: true });
installLifecycleFlush();
const snapshot = () => void autoSnapshot(repo, Object.values(useStore.getState().projects));
void initStore().then(() => window.setTimeout(snapshot, 3000));
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && snapshot());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
