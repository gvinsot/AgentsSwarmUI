import { getPool } from './connection.js';

export async function getAllProjectContexts() {
  const pool = getPool();
  if (!pool) return [];
  try {
    const result = await pool.query('SELECT data FROM project_contexts ORDER BY name');
    return result.rows.map(row => row.data);
  } catch (err) {
    console.error('Failed to load project contexts:', err.message);
    return [];
  }
}

export async function saveProjectContext(ctx) {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO project_contexts (name, data, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (name) DO UPDATE SET data = $2, updated_at = NOW()`,
      [ctx.name, JSON.stringify(ctx)]
    );
  } catch (err) {
    console.error('Failed to save project context:', err.message);
  }
}

export async function deleteProjectContextFromDb(name) {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query('DELETE FROM project_contexts WHERE name = $1', [name]);
  } catch (err) {
    console.error('Failed to delete project context:', err.message);
  }
}
