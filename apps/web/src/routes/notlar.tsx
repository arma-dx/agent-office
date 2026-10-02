import { createFileRoute } from '@tanstack/react-router';
import { BosEkran } from '@/components/durum';

export const Route = createFileRoute('/notlar')({
  component: Notlar,
});

function Notlar() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Notlar</h1>
      <BosEkran
        baslik="Henüz not yok"
        aciklama="Kurumsal hafıza burada olacak. İlk adım: şirket belgelerinin içe aktarılması."
      />
    </div>
  );
}
