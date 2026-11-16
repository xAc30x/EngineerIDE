import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { WINDOW_KIND, WINDOW_LABELS } from './lib/windowKind';

document.title = `EngineerIDE – ${WINDOW_LABELS[WINDOW_KIND]}`;

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error('Cannot start: index.html has no element with id "root".');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
