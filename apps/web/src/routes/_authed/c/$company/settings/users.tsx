import { createFileRoute } from '@tanstack/react-router';
import { EmptyState, ErrorMessage } from '@/components/states';
import { InvitationsSection, InviteForm, MembersSection } from '@/components/users-settings';
import { FORBIDDEN_MESSAGE } from '@/lib/api';
import { companyLabel, useCompany } from '@/lib/session';

/** Settings, Kullanıcılar: invitations, roles, approval rights and passkey resets. Founder only. */
export const Route = createFileRoute('/_authed/c/$company/settings/users')({
  component: UsersSettingsScreen,
});

function UsersSettingsScreen() {
  const company = useCompany();

  if (company.role !== 'founder') {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Kullanıcılar</h1>
        <ErrorMessage message={`${FORBIDDEN_MESSAGE} Kullanıcıları ve davetleri kurucu yönetir.`} />
      </div>
    );
  }

  if (company.kind === 'private_space') {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Kullanıcılar</h1>
        <EmptyState
          title="Kurucu alanı yalnızca size açık"
          description="Bu alana kimse davet edilmez. Kullanıcıları şirket seçiciden bir şirket seçip yönetin."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Kullanıcılar</h1>
        <p className="text-sm text-ink-secondary">
          {companyLabel(company)} için davetler, roller ve onay yetkisi. Davetleri, üye
          değişikliklerini ve passkey sıfırlamayı passkey ile onaylarsınız.
        </p>
      </div>
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_22rem] md:items-start">
        <InviteForm companyId={company.companyId} className="md:order-last" />
        <div className="flex min-w-0 flex-col gap-6">
          <MembersSection companyId={company.companyId} />
          <InvitationsSection companyId={company.companyId} />
        </div>
      </div>
    </div>
  );
}
