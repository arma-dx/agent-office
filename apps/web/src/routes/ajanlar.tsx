import { createFileRoute } from '@tanstack/react-router';
import { BosEkran } from '@/components/durum';

export const Route = createFileRoute('/ajanlar')({
  component: Ajanlar,
});

function Ajanlar() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Ajanlar</h1>
      <BosEkran
        baslik="Henüz etkin ajan yok"
        aciklama="Ajanlar burada birimlerine göre listelenecek; her birinin durdurma düğmesi burada olacak. Ofis görünümü Kasım'da gelecek."
      />
    </div>
  );
}
