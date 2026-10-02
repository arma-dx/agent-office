import { useId } from 'react';
import { Controller, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

/**
 * Ortak form düzeni: react-hook-form ile zod şeması (zodResolver) birlikte kullanılır,
 * alan bu bileşenle çizilir. Hata mesajı zod şemasındaki Türkçe metindir.
 * Açıklama ve hata, ekran okuyucunun alanla birlikte okuması için aria-describedby ile bağlanır.
 */
export function MetinAlani<T extends FieldValues, TDonusmus = T>({
  control,
  ad,
  etiket,
  aciklama,
  cokSatirli = false,
  tur = 'text',
}: {
  control: Control<T, unknown, TDonusmus>;
  ad: FieldPath<T>;
  etiket: string;
  aciklama?: string;
  cokSatirli?: boolean;
  tur?: 'text' | 'email' | 'date' | 'number';
}) {
  const kimlik = useId();
  const aciklamaKimligi = `${kimlik}-aciklama`;
  const hataKimligi = `${kimlik}-hata`;
  return (
    <Controller
      name={ad}
      control={control}
      render={({ field, fieldState }) => {
        const tanimlayanlar =
          [aciklama ? aciklamaKimligi : null, fieldState.invalid ? hataKimligi : null]
            .filter(Boolean)
            .join(' ') || undefined;
        const ortak = {
          id: kimlik,
          'aria-invalid': fieldState.invalid,
          'aria-describedby': tanimlayanlar,
        };
        return (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={kimlik}>{etiket}</FieldLabel>
            {cokSatirli ? (
              <Textarea {...ortak} {...field} />
            ) : (
              <Input {...ortak} type={tur} {...field} />
            )}
            {aciklama ? <FieldDescription id={aciklamaKimligi}>{aciklama}</FieldDescription> : null}
            {fieldState.invalid ? (
              <FieldError id={hataKimligi} errors={[fieldState.error]} />
            ) : null}
          </Field>
        );
      }}
    />
  );
}
