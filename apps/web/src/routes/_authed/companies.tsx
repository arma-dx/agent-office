import { createFileRoute, Link } from '@tanstack/react-router';
import { SignedInPage } from '@/components/layout';
import { EmptyState } from '@/components/states';
import { companyLabel, useRememberCompany, useSession } from '@/lib/session';
import { ROLE_LABELS } from '@/lib/users';

export const Route = createFileRoute('/_authed/companies')({
  component: CompanyPicker,
});

/** After sign-in, for a person with several companies and none remembered. */
function CompanyPicker() {
  const session = useSession();
  const rememberCompany = useRememberCompany();
  return (
    <SignedInPage>
      <div className="flex max-w-xl flex-col gap-4">
        <h1 className="text-xl font-semibold">Şirket seçin</h1>
        {session.memberships.length === 0 ? (
          <EmptyState
            title="Henüz bir şirkete üye değilsiniz"
            description="Sizi davet eden kişiden üyeliğinizi kontrol etmesini isteyin."
          />
        ) : (
          <ul className="rounded-lg border border-line bg-surface">
            {session.memberships.map((m) => (
              <li key={m.companyId} className="border-b border-line last:border-b-0">
                <Link
                  to="/c/$company"
                  params={{ company: m.code }}
                  onClick={() => {
                    rememberCompany.mutate(m.companyId);
                  }}
                  className="flex min-h-14 flex-col justify-center px-4 py-3 hover:bg-row-hover"
                >
                  <span className="text-sm font-medium">{companyLabel(m)}</span>
                  <span className="text-sm text-ink-secondary">{ROLE_LABELS[m.role]}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SignedInPage>
  );
}
