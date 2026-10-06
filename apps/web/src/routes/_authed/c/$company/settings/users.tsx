import { createFileRoute } from '@tanstack/react-router';
import { EmptyState, ErrorMessage } from '@/components/states';
import { InvitationsSection, InviteForm, MembersSection } from '@/components/users-settings';
import { FORBIDDEN_MESSAGE } from '@/lib/api';
import { companyLabel, useCompany } from '@/lib/session';

/** Settings, Kullanıcılar: invitations, roles, approval rights and passkey resets. Founder only. */
export const Route = createFileRoute('/_authed/c/$company/settings/users')({
  staticData: { location: { label: 'Kullanıcılar', parent: 'Ayarlar' } },
  component: UsersSettingsScreen,
});

function UsersSettingsScreen() {
  const company = useCompany();

  if (company.role !== 'founder') {
    return (
      <div className="flex flex-col gap-4">
        <ErrorMessage message={`${FORBIDDEN_MESSAGE} Kullanıcıları ve davetleri kurucu yönetir.`} />
      </div>
    );
  }

  if (company.kind === 'private_space') {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState
          title="Kurucu alanı yalnızca size açık"
          description="Bu alana kimse davet edilmez. Kullanıcıları şirket seçiciden bir şirket seçip yönetin."
        />
      </div>
    );
  }

  return (
    <div className="@container flex max-w-6xl flex-col gap-6">
      <p className="text-sm text-ink-secondary">
        {companyLabel(company)} için davetler, roller ve onay yetkisi. Davetleri, üye
        değişikliklerini ve passkey sıfırlamayı passkey ile onaylarsınız.
      </p>
      {/*
        The form sits beside the lists where the content area is at least 896 px wide (a 1280 px
        window); below that it goes above them. The sidebar takes 240 px, so the window width no
        longer says how wide the content is.
      */}
      <div className="grid gap-6 @4xl:grid-cols-[minmax(0,1fr)_22rem] @4xl:items-start">
        <InviteForm companyId={company.companyId} className="max-w-xl @4xl:order-last" />
        <div className="flex min-w-0 flex-col gap-6">
          <MembersSection companyId={company.companyId} />
          <InvitationsSection companyId={company.companyId} />
        </div>
      </div>
    </div>
  );
}
