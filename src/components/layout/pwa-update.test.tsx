import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pwaMock } from '@/test/pwa-register-mock';
import { PwaUpdatePrompt } from './pwa-update';

describe('atualização controlada da PWA', () => {
  beforeEach(() => {
    pwaMock.updateServiceWorker.mockClear();
  });

  afterEach(() => {
    cleanup();
    pwaMock.needRefresh = false;
  });

  it('não mostra nada quando não há nova versão', () => {
    pwaMock.needRefresh = false;
    const { container } = render(<PwaUpdatePrompt />);
    expect(container).toBeEmptyDOMElement();
  });

  it('avisa sobre a nova versão e só recarrega quando o usuário pede', async () => {
    pwaMock.needRefresh = true;
    render(<PwaUpdatePrompt />);
    expect(screen.getByRole('alertdialog', { name: 'Nova versão disponível' })).toBeInTheDocument();
    expect(pwaMock.updateServiceWorker).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    expect(pwaMock.updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it('"Depois" adia a atualização sem recarregar', async () => {
    pwaMock.needRefresh = true;
    render(<PwaUpdatePrompt />);
    await userEvent.click(screen.getByRole('button', { name: 'Depois' }));
    expect(screen.queryByText('Nova versão disponível')).not.toBeInTheDocument();
    expect(pwaMock.updateServiceWorker).not.toHaveBeenCalled();
  });
});
