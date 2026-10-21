import { useSyncExternalStore } from 'react';

/**
 * Captura o evento `beforeinstallprompt` (Chrome/Edge/Android) para oferecer o
 * botão "Instalar aplicativo". O navegador dispara o evento uma vez por carga da
 * página; chame `captureInstallPrompt()` o quanto antes (ex.: em main.tsx) para
 * não perdê-lo. Importar este módulo também registra a captura.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
let registered = false;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function captureInstallPrompt() {
  if (registered || typeof window === 'undefined') return;
  registered = true;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    notify();
  });
}

captureInstallPrompt();

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    installed ||
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function useInstallPrompt() {
  const available = useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => deferred !== null,
    () => false,
  );
  return {
    canPrompt: available,
    standalone: isStandalone(),
    async install(): Promise<boolean> {
      if (!deferred) return false;
      const event = deferred;
      await event.prompt();
      const choice = await event.userChoice;
      deferred = null;
      notify();
      return choice.outcome === 'accepted';
    },
  };
}
