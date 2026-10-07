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
        title="Ajan listesi henüz kurulmadı"
        description="Ajanları Ofis görünümünden açıp durdurabilirsiniz."
      />
    </div>
  );
}
