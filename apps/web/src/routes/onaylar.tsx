import { createFileRoute } from '@tanstack/react-router';
import { BosEkran } from '@/components/durum';

export const Route = createFileRoute('/onaylar')({
  component: Onaylar,
});

function Onaylar() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Onaylar</h1>
      <BosEkran
        baslik="Onay bekleyen iş yok"
        aciklama="Ajanların dışarı çıkacak işleri burada onayınıza gelir. Onay Masası kurulunca ilk işler burada görünecek."
      />
    </div>
  );
}
