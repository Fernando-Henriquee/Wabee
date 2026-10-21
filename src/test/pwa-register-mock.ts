import { useState } from 'react';
import { vi } from 'vitest';

/** Substitui virtual:pwa-register/react nos testes unitários. */
export const pwaMock = {
  needRefresh: false,
  updateServiceWorker: vi.fn(async (_reload?: boolean) => undefined),
};

export function useRegisterSW() {
  const needRefresh = useState(pwaMock.needRefresh);
  const offlineReady = useState(false);
  return { needRefresh, offlineReady, updateServiceWorker: pwaMock.updateServiceWorker };
}
