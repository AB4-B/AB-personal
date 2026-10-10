import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { initStore, installLifecycleFlush } from './store/store';
import './theme.css';
import './styles.css';

registerSW({ immediate: true });
installLifecycleFlush();
void initStore();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
