import { getPool } from './connection.js';

/**
 * Storages used on PulsarTeam are not stored explicitly — they're derived from
 * the `storage_path` actually assigned to tasks. The picker list (when creating
 * a task) comes from the board's OneDrive (or other) plugin OAuth token.
 */

export interface DerivedStorage {
  provider: string;
  path: string;
}

function rowToStorage(row: any): DerivedStorage {
  return {
    provider: row.storage_provider || 'onedrive',
    path: row.storage_path as string,
  };
}

/** Distinct storages in use by non-deleted tasks across the boards of one project. */
export async function getStoragesForProject(projectId: string): Promise<DerivedStorage[]> {
  const pool = getPool();
  if (!pool) return [];
  const result = await pool.query(
    `SELECT DISTINCT t.storage_provider, t.storage_path
     FROM tasks t
     JOIN boards b ON t.board_id = b.id
     WHERE b.project_id = $1
       AND t.storage_path IS NOT NULL
       AND t.deleted_at IS NULL
     ORDER BY t.storage_path`,
    [projectId]
  );
  return result.rows.map(rowToStorage);
}

/** Distinct storages in use by non-deleted tasks of one board. */
export async function getStoragesForBoard(boardId: string): Promise<DerivedStorage[]> {
  const pool = getPool();
  if (!pool) return [];
  const result = await pool.query(
    `SELECT DISTINCT t.storage_provider, t.storage_path
     FROM tasks t
     WHERE t.board_id = $1
       AND t.storage_path IS NOT NULL
       AND t.deleted_at IS NULL
     ORDER BY t.storage_path`,
    [boardId]
  );
  return result.rows.map(rowToStorage);
}
