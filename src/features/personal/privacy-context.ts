import { createContext, useContext } from 'react';

/** Ocultar valores na tela (para usar perto de outras pessoas). Preferência deste aparelho. */
export interface PrivacyState {
  hidden: boolean;
  toggle: () => void;
}

export const PrivacyContext = createContext<PrivacyState>({ hidden: false, toggle: () => undefined });

export const usePrivacy = () => useContext(PrivacyContext);

export const PRIVACY_KEY = 'wabee.pessoal.ocultar';
