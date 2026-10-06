import { createFileRoute } from '@tanstack/react-router';
import { EmptyState } from '@/components/states';

export const Route = createFileRoute('/_authed/c/$company/approvals')({
  staticData: { location: { label: 'Onaylar' } },
  component: ApprovalsScreen,
});

function ApprovalsScreen() {
  return (
    <div className="flex flex-col gap-4">
      <EmptyState
        variant="page"
        title="Onay bekleyen iş yok"
        description="Ajanların dışarı çıkacak işleri burada onayınıza gelir. Onay Masası kurulunca ilk işler burada görünecek."
      />
    </div>
  );
}
