import { createTestDatabaseSetup } from '@agent-office/db/test/database';
import { loadFixtures } from './fixtures.ts';

export default createTestDatabaseSetup('agent_office_test_api', loadFixtures);
