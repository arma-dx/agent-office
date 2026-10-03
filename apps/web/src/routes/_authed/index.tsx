import { createFileRoute, Navigate } from '@tanstack/react-router';
import { defaultCompany, useSession } from '@/lib/session';

/** "/" opens the remembered company, or the only one; with several and none remembered, the picker. */
export const Route = createFileRoute('/_authed/')({
  component: HomeRedirect,
});

function HomeRedirect() {
  const session = useSession();
  const company = defaultCompany(session);
  if (company) {
    return <Navigate to="/c/$company" params={{ company: company.code }} replace />;
  }
  return <Navigate to="/companies" replace />;
}
