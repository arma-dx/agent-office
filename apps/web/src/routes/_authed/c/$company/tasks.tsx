import { createFileRoute } from '@tanstack/react-router';
import { EmptyState } from '@/components/states';

export const Route = createFileRoute('/_authed/c/$company/tasks')({
  staticData: { location: { label: 'Görevler' } },
  component: TasksScreen,
});

function TasksScreen() {
  return (
    <div className="flex flex-col gap-4">
      <EmptyState
        variant="page"
        title="Henüz görev yok"
        description="Görev kaydı kurulunca talepler ve atanan işler burada listelenecek."
      />
    </div>
  );
}
