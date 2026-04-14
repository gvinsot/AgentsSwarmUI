import { getPool } from './connection.js';

export async function getAllSkills() {
  const pool = getPool();
  if (!pool) return [];

  try {
    const result = await pool.query('SELECT data FROM skills ORDER BY created_at');
    return result.rows.map(row => row.data);
  } catch (err) {
    console.error('Failed to load skills:', err.message);
    return [];
  }
}

export async function saveSkill(skill) {
  const pool = getPool();
  if (!pool) return;

  try {
    await pool.query(
      `INSERT INTO skills (id, data, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()`,
      [skill.id, JSON.stringify(skill)]
    );
  } catch (err) {
    console.error('Failed to save skill:', err.message);
  }
}

export async function deleteSkillFromDb(id) {
  const pool = getPool();
  if (!pool) return;

  try {
    await pool.query('DELETE FROM skills WHERE id = $1', [id]);
  } catch (err) {
    console.error('Failed to delete skill:', err.message);
  }
}
