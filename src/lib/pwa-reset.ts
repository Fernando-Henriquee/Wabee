/**
 * Força o aparelho a baixar a versão mais nova do app: remove o service worker e os arquivos
 * guardados e recarrega. Mantém o login e os dados (nada é apagado do navegador além do cache do app).
 * Serve para quem ficou preso numa versão antiga (o aviso "Nova versão disponível" só aparece dentro do app).
 */
export async function resetAppAndReload(): Promise<void> {
  try {
    const registrations = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(registrations.map((registration) => registration.unregister()));
    const keys = (await globalThis.caches?.keys?.()) ?? [];
    await Promise.all(keys.map((key) => globalThis.caches.delete(key)));
  } catch {
    // sem service worker ou sem permissão: o recarregamento abaixo já ajuda
  }
  window.location.reload();
}
