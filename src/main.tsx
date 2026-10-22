import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/app';
import { captureInstallPrompt } from './features/settings/install-prompt';
import './index.css';

// O evento de instalação da PWA chega uma vez por carga: capturá-lo antes de qualquer tela.
captureInstallPrompt();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
