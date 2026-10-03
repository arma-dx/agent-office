import { createFileRoute } from '@tanstack/react-router';
import { EmptyState } from '@/components/states';

export const Route = createFileRoute('/agents')({
  component: AgentsScreen,
});

function AgentsScreen() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Ajanlar</h1>
      <EmptyState
        title="Henüz etkin ajan yok"
        description="Ajanlar burada birimlerine göre listelenecek; her birinin durdurma düğmesi burada olacak. Ofis görünümü Kasım'da gelecek."
      />
    </div>
  );
}
