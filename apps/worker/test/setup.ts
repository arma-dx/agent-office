import { parseCards, readCardFiles, syncCards } from '@agent-office/db/cards';
import {
  parseDefinitions,
  readDefinitionFiles,
  syncDefinitions,
} from '@agent-office/db/definitions';
import { createTestDatabaseSetup } from '@agent-office/db/test/database';
import { ids, loadFixtures as loadApiFixtures } from '../../api/test/fixtures.ts';

const AGENTS_DIR = new URL('../../../agents/', import.meta.url);
const SKILLS_DIR = new URL('../../../skills/', import.meta.url);

/**
 * The worker's test database: the people and companies of the API's fixtures (so that the flow
 * test can drive the API), and on top of them the repository's own units, cards, skills and tool
 * catalog, written by the real sync. The runner is tested against the cards it will really run.
 */
export default createTestDatabaseSetup('agent_office_test_worker', async (client) => {
  await loadApiFixtures(client);
  await syncDefinitions(client, parseDefinitions(await readDefinitionFiles(AGENTS_DIR)), {
    // The API's fixtures hold a few agents no card names.
    allowOrphanAgents: true,
  });
  await syncCards(client, parseCards(await readCardFiles(AGENTS_DIR, SKILLS_DIR)), 'abc1234');
  // The coordinator is open in Arma DX already; the first unit agent is opened in both companies
  // and the coordinator in Pillika (the isolation cases need a run that could start there).
  await client.query(`
    insert into office.company_agents (company_id, agent_code, status) values
      ('${ids.arma}', 'SOS-2', 'enabled'),
      ('${ids.pillika}', 'KOR-1', 'enabled'),
      ('${ids.pillika}', 'SOS-2', 'enabled')`);
});
