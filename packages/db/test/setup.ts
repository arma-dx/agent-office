import { createTestDatabaseSetup } from './database.ts';
import { loadFixtures } from './fixtures.ts';

export default createTestDatabaseSetup('agent_office_test_db', loadFixtures);
