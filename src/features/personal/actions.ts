import { createContext, useContext } from 'react';

/** Ações compartilhadas pelas telas da aba Pessoal. */
export interface PersonalActions {
  /** Abre o lançamento rápido (opcionalmente numa data). */
  openAdd: (date?: string) => void;
}

export const PersonalActionsContext = createContext<PersonalActions>({ openAdd: () => undefined });

export const usePersonalActions = () => useContext(PersonalActionsContext);
