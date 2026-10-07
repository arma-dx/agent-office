import { createFileRoute } from '@tanstack/react-router';
import { PasskeyReminder } from '@/components/security-settings';
import { EmptyState } from '@/components/states';

export const Route = createFileRoute('/_authed/c/$company/')({
  staticData: { location: { label: 'Bugün' } },
  component: TodayScreen,
});

function TodayScreen() {
  return (
    <div className="flex flex-col gap-4">
      <PasskeyReminder />
      <EmptyState
        variant="page"
        title="Bugün listesi henüz kurulmadı"
        description="Onayınızı bekleyen işler Onaylar'da, talepleriniz Talepler'de."
      />
    </div>
  );
}
