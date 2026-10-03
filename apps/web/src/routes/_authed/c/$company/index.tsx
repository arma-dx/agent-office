import { createFileRoute } from '@tanstack/react-router';
import { PasskeyReminder } from '@/components/security-settings';
import { EmptyState } from '@/components/states';

export const Route = createFileRoute('/_authed/c/$company/')({
  component: TodayScreen,
});

function TodayScreen() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Bugün</h1>
      <PasskeyReminder />
      <EmptyState
        title="Bugün için bir şey yok"
        description="Bekleyen onaylar, bugünkü görevler ve ajanların son işleri burada görünecek."
      />
    </div>
  );
}
