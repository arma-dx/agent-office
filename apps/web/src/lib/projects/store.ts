import type { ProjectDetail } from '@agent-office/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { projectKey, projectsKey } from './query.ts';

/**
 * Every change of a project answers with the whole project. The page shows that answer at once
 * (nothing is shown as changed before the API has stored it, and nothing is asked a second time),
 * and the list is read again when it is next looked at.
 */
export function useStoreProject(companyId: string): (project: ProjectDetail) => void {
  const queryClient = useQueryClient();
  return useCallback(
    (project: ProjectDetail) => {
      queryClient.setQueryData(projectKey(companyId, project.id), project);
      void queryClient.invalidateQueries({ queryKey: projectsKey(companyId) });
    },
    [queryClient, companyId],
  );
}
