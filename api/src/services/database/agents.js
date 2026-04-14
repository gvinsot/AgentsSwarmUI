import { getPool } from './connection.js';

export async function getAllAgents() {
  const pool = getPool();
  if (!pool) return [];

  try {
    // Clean any leftover todoList from agent JSONB (tasks now live in the tasks table)
    await pool.query(`UPDATE agents SET data = data - 'todoList' WHERE data ? 'todoList'`).catch(() => {});

    const result = await pool.query('SELECT data, owner_id FROM agents ORDER BY created_at');
    return result.rows.map(row => {
      const { todoList, ...agent } = row.data;
      // Ensure ownerId from the DB column is always present in the agent object
      if (row.owner_id && !agent.ownerId) {
        agent.ownerId = row.owner_id;
      }
      return agent;
    });
  } catch (err) {
    console.error('Failed to load agents:', err.message);
    return [];
  }
}

export async function saveAgent(agent) {
  const pool = getPool();
  if (!pool) return;

  try {
    // Exclude todoList from JSONB — tasks are now stored in the dedicated tasks table
    const { todoList, ...agentData } = agent;
    await pool.query(
      `INSERT INTO agents (id, data, owner_id, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (id) DO UPDATE SET data = $2, owner_id = $3, updated_at = NOW()`,
      [agent.id, JSON.stringify(agentData), agent.ownerId || null]
    );
  } catch (err) {
    console.error('Failed to save agent:', err.message);
  }
}

export async function deleteAgentFromDb(id) {
  const pool = getPool();
  if (!pool) return;

  try {
    await pool.query('DELETE FROM agents WHERE id = $1', [id]);
  } catch (err) {
    console.error('Failed to delete agent:', err.message);
  }
}

// ── Agent owner_id helpers ──────────────────────────────────────────────────

export async function setAgentOwner(agentId, ownerId) {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query('UPDATE agents SET owner_id = $2 WHERE id = $1', [agentId, ownerId]);
  } catch (err) {
    console.error('Failed to set agent owner:', err.message);
  }
}

export async function getAgentsByOwner(ownerId) {
  const pool = getPool();
  if (!pool) return [];
  try {
    const result = await pool.query(
      'SELECT data FROM agents WHERE owner_id = $1 ORDER BY created_at',
      [ownerId]
    );
    return result.rows.map(row => row.data);
  } catch (err) {
    console.error('Failed to get agents by owner:', err.message);
    return [];
  }
}
