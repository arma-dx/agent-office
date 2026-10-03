import { useId } from 'react';
import { Controller, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

/**
 * Shared form pattern: react-hook-form is used together with a zod schema (zodResolver),
 * and the field is drawn with this component. The error message is the Turkish text in the zod schema.
 * The description and error are linked with aria-describedby so screen readers read them with the field.
 */
export function TextField<T extends FieldValues, TTransformed = T>({
  control,
  name,
  label,
  description,
  multiline = false,
  type = 'text',
}: {
  control: Control<T, unknown, TTransformed>;
  name: FieldPath<T>;
  label: string;
  description?: string;
  multiline?: boolean;
  type?: 'text' | 'email' | 'date' | 'number';
}) {
  const id = useId();
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => {
        const describedBy =
          [description ? descriptionId : null, fieldState.invalid ? errorId : null]
            .filter(Boolean)
            .join(' ') || undefined;
        const sharedProps = {
          id,
          'aria-invalid': fieldState.invalid,
          'aria-describedby': describedBy,
        };
        return (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            {multiline ? (
              <Textarea {...sharedProps} {...field} />
            ) : (
              <Input {...sharedProps} type={type} {...field} />
            )}
            {description ? (
              <FieldDescription id={descriptionId}>{description}</FieldDescription>
            ) : null}
            {fieldState.invalid ? <FieldError id={errorId} errors={[fieldState.error]} /> : null}
          </Field>
        );
      }}
    />
  );
}
