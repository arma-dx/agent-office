import { createFileRoute } from '@tanstack/react-router';
import { AppLayout, SignedInPage } from '@/components/layout';
import { NotFoundScreen } from '@/components/screens';
import { CompanyContext, useSession } from '@/lib/session';

/**
 * Pages of one company: /c/<company code>/... The code must be one of the person's memberships;
 * any other code shows the not found screen (the API also checks the company on every request).
 */
export const Route = createFileRoute('/_authed/c/$company')({
  component: CompanyLayout,
});

function CompanyLayout() {
  const { company: code } = Route.useParams();
  const session = useSession();
  const membership = session.memberships.find((m) => m.code === code);
  if (!membership) {
    return (
      <SignedInPage>
        <NotFoundScreen />
      </SignedInPage>
    );
  }
  return (
    <CompanyContext value={membership}>
      <AppLayout />
    </CompanyContext>
  );
}
