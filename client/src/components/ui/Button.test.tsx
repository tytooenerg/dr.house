import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';

describe('Button', () => {
  it('fires onClick when enabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Comprar</Button>);
    await user.click(screen.getByRole('button', { name: 'Comprar' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire onClick when disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Comprar
      </Button>
    );
    await user.click(screen.getByRole('button', { name: 'Comprar' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('applies the danger variant classes', () => {
    render(<Button variant="danger">Rejeitar</Button>);
    expect(screen.getByRole('button', { name: 'Rejeitar' }).className).toContain('bg-redBg');
  });
});
