import { createFileRoute } from '@tanstack/react-router';
import { BosEkran } from '@/components/durum';

export const Route = createFileRoute('/gorevler')({
  component: Gorevler,
});

function Gorevler() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Görevler</h1>
      <BosEkran
        baslik="Henüz görev yok"
        aciklama="Görev kaydı kurulunca talepler ve atanan işler burada listelenecek."
      />
    </div>
  );
}
