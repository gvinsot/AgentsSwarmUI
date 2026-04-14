import { getPool } from './connection.js';

export async function getAllAgentSkills() {
  const pool = getPool();
  if (!pool) return [];
  try {
    const result = await pool.query('SELECT data FROM agent_skills ORDER BY updated_at DESC');
    return result.rows.map(row => row.data);
  } catch (err) {
    console.error('Failed to load agent skills:', err.message);
    return [];
  }
}

export async function searchAgentSkills(query) {
  const pool = getPool();
  if (!pool) return [];
  try {
    const result = await pool.query(
      `SELECT data, ts_rank(
          to_tsvector('english',
            COALESCE(data->>'name', '') || ' ' ||
            COALESCE(data->>'description', '') || ' ' ||
            COALESCE(data->>'category', '') || ' ' ||
            COALESCE(data->>'instructions', '')
          ),
          plainto_tsquery('english', $1)
        ) AS rank
       FROM agent_skills
       WHERE to_tsvector('english',
          COALESCE(data->>'name', '') || ' ' ||
          COALESCE(data->>'description', '') || ' ' ||
          COALESCE(data->>'category', '') || ' ' ||
          COALESCE(data->>'instructions', '')
        ) @@ plainto_tsquery('english', $1)
          OR data->>'name' ILIKE '%' || $1 || '%'
          OR data->>'description' ILIKE '%' || $1 || '%'
          OR data->>'category' ILIKE '%' || $1 || '%'
       ORDER BY rank DESC, updated_at DESC
       LIMIT 20`,
      [query]
    );
    return result.rows.map(row => row.data);
  } catch (err) {
    console.error('Failed to search agent skills:', err.message);
    return [];
  }
}

export async function getAgentSkillById(id) {
  const pool = getPool();
  if (!pool) return null;
  try {
    const result = await pool.query('SELECT data FROM agent_skills WHERE id = $1', [id]);
    return result.rows[0]?.data || null;
  } catch (err) {
    console.error('Failed to get agent skill:', err.message);
    return null;
  }
}

export async function saveAgentSkill(skill) {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO agent_skills (id, data, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()`,
      [skill.id, JSON.stringify(skill)]
    );
  } catch (err) {
    console.error('Failed to save agent skill:', err.message);
  }
}

export async function deleteAgentSkillFromDb(id) {
  const pool = getPool();
  if (!pool) return false;
  try {
    const result = await pool.query('DELETE FROM agent_skills WHERE id = $1', [id]);
    return result.rowCount > 0;
  } catch (err) {
    console.error('Failed to delete agent skill:', err.message);
    return false;
  }
}
