import type { ClientBase } from 'pg';

/**
 * Anything a statement can be sent through: a pooled client inside a transaction, or a single
 * client.
 */
export type Queryable = Pick<ClientBase, 'query'>;
