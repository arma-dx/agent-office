import { zodResolver } from '@hookform/resolvers/zod';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { MetinAlani } from './form-alani.tsx';

const sema = z.object({
  baslik: z.string().trim().min(3, 'Başlık en az 3 karakter olmalı.'),
});
type Deger = z.infer<typeof sema>;

function DenemeFormu({ gonder }: { gonder: (d: Deger) => void }) {
  const form = useForm<Deger>({ resolver: zodResolver(sema), defaultValues: { baslik: '' } });
  return (
    <form
      noValidate
      onSubmit={(e) => {
        void form.handleSubmit(gonder)(e);
      }}
    >
      <MetinAlani control={form.control} ad="baslik" etiket="Başlık" />
      <Button type="submit">Kaydet</Button>
    </form>
  );
}

describe('MetinAlani', () => {
  it('zod şemasındaki Türkçe hatayı gösterir ve geçersiz formu göndermez', async () => {
    const gonder = vi.fn();
    render(<DenemeFormu gonder={gonder} />);
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(await screen.findByText('Başlık en az 3 karakter olmalı.')).toBeInTheDocument();
    const alan = screen.getByLabelText('Başlık');
    expect(alan).toHaveAttribute('aria-invalid', 'true');
    // Ekran okuyucu hatayı alanla birlikte okur.
    expect(alan).toHaveAccessibleDescription('Başlık en az 3 karakter olmalı.');
    expect(gonder).not.toHaveBeenCalled();
  });

  it('geçerli değeri gönderir', async () => {
    const gonder = vi.fn();
    render(<DenemeFormu gonder={gonder} />);
    await userEvent.type(screen.getByLabelText('Başlık'), 'Teklif hazırlığı');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    await vi.waitFor(() => {
      expect(gonder).toHaveBeenCalledWith({ baslik: 'Teklif hazırlığı' }, expect.anything());
    });
  });
});
