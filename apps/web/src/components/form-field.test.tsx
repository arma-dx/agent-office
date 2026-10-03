import { zodResolver } from '@hookform/resolvers/zod';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { TextField } from './form-field.tsx';

const schema = z.object({
  title: z.string().trim().min(3, 'Başlık en az 3 karakter olmalı.'),
});
type Values = z.infer<typeof schema>;

function TestForm({ onSubmit }: { onSubmit: (v: Values) => void }) {
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { title: '' } });
  return (
    <form
      noValidate
      onSubmit={(e) => {
        void form.handleSubmit(onSubmit)(e);
      }}
    >
      <TextField control={form.control} name="title" label="Başlık" />
      <Button type="submit">Kaydet</Button>
    </form>
  );
}

describe('TextField', () => {
  it('shows the Turkish error from the zod schema and does not submit an invalid form', async () => {
    const onSubmit = vi.fn();
    render(<TestForm onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(await screen.findByText('Başlık en az 3 karakter olmalı.')).toBeInTheDocument();
    const field = screen.getByLabelText('Başlık');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    // Screen readers read the error together with the field.
    expect(field).toHaveAccessibleDescription('Başlık en az 3 karakter olmalı.');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits a valid value', async () => {
    const onSubmit = vi.fn();
    render(<TestForm onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText('Başlık'), 'Teklif hazırlığı');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ title: 'Teklif hazırlığı' }, expect.anything());
    });
  });
});
