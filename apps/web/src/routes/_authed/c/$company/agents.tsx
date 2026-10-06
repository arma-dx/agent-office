import { createFileRoute } from '@tanstack/react-router';
import { EmptyState } from '@/components/states';

export const Route = createFileRoute('/_authed/c/$company/agents')({
  staticData: { location: { label: 'Ajanlar' } },
  component: AgentsScreen,
});

function AgentsScreen() {
  return (
    <div className="flex flex-col gap-4">
      <EmptyState
        variant="page"
        title="Henüz etkin ajan yok"
        description="Ajanlar burada birimlerine göre listelenecek; her birinin durdurma düğmesi burada olacak."
      />
    </div>
  );
}
