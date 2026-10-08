import { createFileRoute } from '@tanstack/react-router';
import { PasskeyReminder } from '@/components/security-settings';
import { EmptyState } from '@/components/states';
import { TodayLists } from '@/components/today/today-lists';
import { useCompany } from '@/lib/session';

/**
 * "Bugün" (8 October decision 7): first what is expected of the person in the selected company,
 * then their notifications. No decision is given here: a row opens the page of its request, where
 * the card is (docs/SONRA.md W-n). Kurucu alanı has no request, so it says so and asks nothing.
 */
export const Route = createFileRoute('/_authed/c/$company/')({
  staticData: { location: { label: 'Bugün' } },
  component: TodayScreen,
});

function TodayScreen() {
  const company = useCompany();
  return (
    <div className="flex flex-col gap-8">
      <PasskeyReminder />
      {company.kind === 'private_space' ? (
        <EmptyState
          title="Kurucu alanında talep yok"
          description="Talepler şirketlerde açılır. Sizden beklenenleri görmek için şirket menüsünden bir şirket seçin."
        />
      ) : (
        // A change of company starts the screen again: the order of the rows is this company's.
        <TodayLists key={company.companyId} />
      )}
    </div>
  );
}
