import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { PageLoading } from '@/components/layout';
import { forgetInstall, matchInstall } from '@/lib/github/install';
import { defaultCompany, useSession } from '@/lib/session';

/**
 * /github/setup: where GitHub sends the browser after the founder installed a company's app (the
 * Setup URL of both apps). The page changes nothing and asks the API nothing: GitHub warns that
 * anybody can open this address with any `installation_id`, so the connection is written only on
 * Ayarlar > Bağlantılar, by the founder's own press and passkey, from what the API itself reads
 * at GitHub. Of the address only `state` is read; `installation_id` never is.
 *
 * The state chooses which company's Bağlantılar page opens: the one the founder left from, when
 * the state is the one this tab stored less than an hour ago (lib/github/install.ts); otherwise
 * the company the session has. The address is replaced at once, so its query does not stay in
 * the history. Where the Bağlantılar page has nothing for the person (an external person, the
 * founder's private space) Bugün opens instead.
 */
const searchSchema = z.object({ state: z.string().max(200).optional().catch(undefined) });

export const Route = createFileRoute('/_authed/github/setup')({
  validateSearch: (search) => searchSchema.parse(search),
  component: GithubSetupReturn,
});

function GithubSetupReturn() {
  const session = useSession();
  const navigate = useNavigate();
  const { state } = Route.useSearch();
  // Read once, without changing anything: a render may run twice.
  const [startedFrom] = useState(() => matchInstall(state));

  useEffect(() => {
    // A stored state is good for one return, whatever came back.
    forgetInstall();
    const company =
      session.memberships.find((membership) => membership.code === startedFrom) ??
      defaultCompany(session);
    if (!company) {
      void navigate({ to: '/', replace: true });
    } else if (company.kind === 'company' && company.role !== 'external') {
      void navigate({
        to: '/c/$company/settings/connections',
        params: { company: company.code },
        replace: true,
      });
    } else {
      void navigate({ to: '/c/$company', params: { company: company.code }, replace: true });
    }
  }, [navigate, session, startedFrom]);

  return <PageLoading />;
}
