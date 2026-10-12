import { createFileRoute } from '@tanstack/react-router';
import { GithubConnectionSection } from '@/components/github-connection';
import { EmptyState, ErrorMessage } from '@/components/states';
import {
  CONNECTIONS_FOUNDER_ONLY,
  CONNECTIONS_PRIVATE_SPACE,
  connectionsIntro,
} from '@/lib/github/labels';
import { companyLabel, useCompany } from '@/lib/session';

/**
 * Settings, Bağlantılar: what the company in the address is connected to outside the panel. Today
 * that is GitHub (8 October 2026, decision 19: connected once, from the company's settings).
 * Founder only; no request is sent for anybody else, nor in the founder's private space.
 */
export const Route = createFileRoute('/_authed/c/$company/settings/connections')({
  staticData: { location: { label: 'Bağlantılar', parent: 'Ayarlar' } },
  component: ConnectionsSettingsScreen,
});

function ConnectionsSettingsScreen() {
  const company = useCompany();

  if (company.role !== 'founder') {
    return (
      <div className="flex flex-col gap-4">
        <ErrorMessage message={CONNECTIONS_FOUNDER_ONLY} />
      </div>
    );
  }

  if (company.kind === 'private_space') {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState {...CONNECTIONS_PRIVATE_SPACE} />
      </div>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <p className="text-sm text-ink-secondary">{connectionsIntro(companyLabel(company))}</p>
      {/* Keyed by the company: nothing of one company's page stays when the other is selected. */}
      <GithubConnectionSection key={company.companyId} company={company} />
    </div>
  );
}
