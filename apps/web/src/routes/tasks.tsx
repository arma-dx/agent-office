import { createFileRoute } from '@tanstack/react-router';
import { EmptyState } from '@/components/states';

export const Route = createFileRoute('/tasks')({
  component: TasksScreen,
});

function TasksScreen() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Görevler</h1>
      <EmptyState
        title="Henüz görev yok"
        description="Görev kaydı kurulunca talepler ve atanan işler burada listelenecek."
      />
    </div>
  );
}
