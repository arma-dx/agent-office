import type { ProjectDetail } from '@agent-office/shared';
import { useId } from 'react';
import { ProjectTile } from '@/components/projects/project-tile';
import { StatusBadge } from '@/components/status';
import { formatDay, formatFull } from '@/lib/dates';
import {
  agentsSentence,
  COLOR_NAME,
  CONTRACT_WORD,
  ICON_NAME,
  PERMISSION_WORD,
} from '@/lib/projects/labels';
import { personName } from '@/lib/requests/labels';

// The names take a fixed column, so every value starts at the same place.
const FIELDS = 'grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 gap-y-3';
const FIELD_NAME = 'text-ink-secondary';
const SECTION = 'flex flex-col gap-2';
const SECTION_HEADING = 'font-medium';

/**
 * The properties of a project, for the shell's properties panel: what the project is (status,
 * customer, target date, colour and icon, members, who opened it and when), then its AI
 * permission, then the contract permissions of its customer. Rule 12 reads both permissions; the
 * sentence under the first says what they mean together for this project.
 */
export function ProjectProperties({ project }: { project: ProjectDetail }) {
  const aiHeading = useId();
  const contractHeading = useId();
  return (
    <div className="flex flex-col gap-5 text-sm">
      <dl className={FIELDS}>
        <dt className={FIELD_NAME}>Durum</dt>
        <dd>
          <StatusBadge kind="project" status={project.status} />
        </dd>
        <dt className={FIELD_NAME}>Müşteri</dt>
        <dd className="break-words">{project.customer?.name ?? 'Müşteri yok'}</dd>
        <dt className={FIELD_NAME}>Hedef tarih</dt>
        <dd>
          {project.targetDate ? (
            <time dateTime={project.targetDate}>{formatDay(project.targetDate)}</time>
          ) : (
            'Belirlenmedi'
          )}
        </dd>
        <dt className={FIELD_NAME}>Renk ve simge</dt>
        <dd className="flex items-center gap-2">
          <ProjectTile color={project.color} icon={project.icon} />
          {COLOR_NAME[project.color]}, {ICON_NAME[project.icon]}
        </dd>
        <dt className={FIELD_NAME}>Üyeler</dt>
        <dd className="tabular-nums">{project.members.length} kişi</dd>
        <dt className={FIELD_NAME}>Oluşturan</dt>
        <dd className="break-words">
          {project.createdBy ? personName(project.createdBy) : 'Bilinmiyor'}
        </dd>
        <dt className={FIELD_NAME}>Oluşturulma</dt>
        <dd>
          <time dateTime={project.createdAt}>{formatFull(project.createdAt)}</time>
        </dd>
      </dl>

      <section aria-labelledby={aiHeading} className={SECTION}>
        <h3 id={aiHeading} className={SECTION_HEADING}>
          Yapay zekâ izni
        </h3>
        {/* "İzin açık", never "Açık" alone: beside it stands a project that is itself open or
            closed. */}
        <p>{PERMISSION_WORD[project.aiAllowed ? 'open' : 'closed']}</p>
        <p className="text-ink-secondary">{agentsSentence(project)}</p>
        {project.actions.setAiPermission ? null : (
          <p className="text-ink-secondary">İzni yalnızca kurucu değiştirir.</p>
        )}
      </section>

      {project.customer ? (
        <section aria-labelledby={contractHeading} className={SECTION}>
          <h3 id={contractHeading} className={SECTION_HEADING}>
            Müşterinin sözleşmesi
          </h3>
          <dl className={FIELDS}>
            <dt className={FIELD_NAME}>Yapay zekâ kullanımı</dt>
            <dd>{CONTRACT_WORD[project.customer.aiAllowed ? 'allowed' : 'forbidden']}</dd>
            {/* The automated processing permission is the founder's to read. */}
            {project.customer.automatedProcessingAllowed === null ? null : (
              <>
                <dt className={FIELD_NAME}>Kodla otomatik işleme</dt>
                <dd>
                  {
                    CONTRACT_WORD[
                      project.customer.automatedProcessingAllowed ? 'allowed' : 'forbidden'
                    ]
                  }
                </dd>
              </>
            )}
          </dl>
          <p className="text-ink-secondary">
            {project.actions.setCustomerPermissions
              ? 'Bu izinler müşterinin bütün projeleri için geçerlidir.'
              : 'İzinleri yalnızca kurucu değiştirir.'}
          </p>
        </section>
      ) : null}
    </div>
  );
}
