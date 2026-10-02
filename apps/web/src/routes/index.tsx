import { createFileRoute } from '@tanstack/react-router';
import { BosEkran } from '@/components/durum';

export const Route = createFileRoute('/')({
  component: Bugun,
});

function Bugun() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Bugün</h1>
      <BosEkran
        baslik="Bugün için bir şey yok"
        aciklama="Bekleyen onaylar, bugünkü görevler ve ajanların son işleri burada görünecek."
      />
    </div>
  );
}
