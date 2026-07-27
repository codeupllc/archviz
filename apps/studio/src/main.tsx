import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Safety net for the rare "Maximum update depth exceeded" crash that some
// combination of React Flow + controlled state can still trigger. Since the
// document is autosaved on every change, a reload loses nothing — so instead
// of leaving the user staring at a white screen, we reload once automatically
// and only show a manual-refresh banner if that doesn't resolve it (avoids a
// reload loop if the crash is somehow deterministic on load).
window.addEventListener('error', (event) => {
  const message = event.message ?? String(event.error?.message ?? '');
  if (!message.includes('Maximum update depth exceeded')) return;

  const key = 'archviz:auto-reload-at';
  const last = Number(sessionStorage.getItem(key) ?? '0');
  const now = Date.now();
  if (now - last > 4000) {
    sessionStorage.setItem(key, String(now));
    window.location.reload();
    return;
  }

  const banner = document.createElement('div');
  banner.textContent =
    'Archviz hit a rendering glitch and could not recover automatically. Please refresh the page (your work is autosaved).';
  banner.style.cssText =
    'position:fixed;top:0;left:0;right:0;z-index:99999;background:#fee2e2;color:#991b1b;' +
    'font:13px/1.4 system-ui,sans-serif;padding:10px 16px;text-align:center;' +
    'border-bottom:1px solid #fca5a5;';
  document.body.prepend(banner);
});

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
