import { createFileRoute } from '@tanstack/react-router';
import { EmptyState } from '@/components/states';

export const Route = createFileRoute('/_authed/c/$company/notes')({
  component: NotesScreen,
});

function NotesScreen() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Notlar</h1>
      <EmptyState
        title="Henüz not yok"
        description="Kurumsal hafıza burada olacak. İlk adım: şirket belgelerinin içe aktarılması."
      />
    </div>
  );
}
