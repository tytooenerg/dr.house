import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Field, Input } from './Input';

describe('Field', () => {
  it('associates the label with its child input via htmlFor/id, so clicking the label focuses the field', async () => {
    const user = userEvent.setup();
    render(
      <Field label="CNPJ da instituição">
        <Input placeholder="00.000.000/0001-00" />
      </Field>
    );
    const input = screen.getByLabelText('CNPJ da instituição');
    expect(input).toHaveAttribute('placeholder', '00.000.000/0001-00');
    await user.click(screen.getByText('CNPJ da instituição'));
    expect(input).toHaveFocus();
  });

  it('respects an explicit id already set on the child instead of overwriting it', () => {
    render(
      <Field label="E-mail">
        <Input id="custom-email-id" />
      </Field>
    );
    expect(screen.getByLabelText('E-mail')).toHaveAttribute('id', 'custom-email-id');
  });
});
