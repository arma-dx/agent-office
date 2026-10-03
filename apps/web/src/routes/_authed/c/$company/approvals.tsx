import { createFileRoute } from '@tanstack/react-router';
import { EmptyState } from '@/components/states';

export const Route = createFileRoute('/_authed/c/$company/approvals')({
  component: ApprovalsScreen,
});

function ApprovalsScreen() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Onaylar</h1>
      <EmptyState
        title="Onay bekleyen iş yok"
        description="Ajanların dışarı çıkacak işleri burada onayınıza gelir. Onay Masası kurulunca ilk işler burada görünecek."
      />
    </div>
  );
}
