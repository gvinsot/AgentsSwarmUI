import pg from 'pg';

const { Pool } = pg;

let pool = null;

export async function initDatabase() {
  const connectionString = process.env.DATABASE_URL;
  
  if (!connectionString) {
    console.log('⚠️  DATABASE_URL not set, agents will not be persisted');
    return false;
  }

  try {
    pool = new Pool({ connectionString });
    
    // Test connection
    await pool.query('SELECT NOW()');
    console.log('✅ Connected to PostgreSQL');

    // Create agents table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agents (
        id UUID PRIMARY KEY,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    console.log('✅ Agents table ready');
    return true;
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    pool = null;
    return false;
  }
}

export async function getAllAgents() {
  if (!pool) return [];
  
  try {
    const result = await pool.query('SELECT data FROM agents ORDER BY created_at');
    return result.rows.map(row => row.data);
  } catch (err) {
    console.error('Failed to load agents:', err.message);
    return [];
  }
}

export async function saveAgent(agent) {
  if (!pool) return;
  
  try {
    await pool.query(
      `INSERT INTO agents (id, data, updated_at) 
       VALUES ($1, $2, NOW()) 
       ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()`,
      [agent.id, JSON.stringify(agent)]
    );
  } catch (err) {
    console.error('Failed to save agent:', err.message);
  }
}

export async function deleteAgentFromDb(id) {
  if (!pool) return;
  
  try {
    await pool.query('DELETE FROM agents WHERE id = $1', [id]);
  } catch (err) {
    console.error('Failed to delete agent:', err.message);
  }
}

export function getPool() {
  return pool;
}
