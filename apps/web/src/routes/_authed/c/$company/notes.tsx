import { createFileRoute } from '@tanstack/react-router';
import { EmptyState } from '@/components/states';

export const Route = createFileRoute('/_authed/c/$company/notes')({
  staticData: { location: { label: 'Notlar' } },
  component: NotesScreen,
});

function NotesScreen() {
  return (
    <div className="flex flex-col gap-4">
      <EmptyState
        variant="page"
        title="Henüz not yok"
        description="Kurumsal hafıza burada olacak. İlk adım: şirket belgelerinin içe aktarılması."
      />
    </div>
  );
}
