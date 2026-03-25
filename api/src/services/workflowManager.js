import { getPool } from './database.js';

// ── Default workflow configuration ─────────────────────────────────────────

const DEFAULT_COLUMNS = [
  { id: 'idea', label: 'Ideas', color: '#a855f7' },
  { id: 'backlog', label: 'Backlog', color: '#6b7280' },
  { id: 'pending', label: 'Pending', color: '#3b82f6' },
  { id: 'in_progress', label: 'In Progress', color: '#eab308' },
  { id: 'done', label: 'Done', color: '#22c55e' },
];

const DEFAULT_TRANSITIONS = [
  { from: 'idea', to: 'backlog', agent: 'product-manager', autoRefine: true, mode: 'refine', requireApproval: false },
  { from: 'backlog', to: 'pending', agent: null, autoRefine: false, mode: 'refine', requireApproval: false },
  { from: 'pending', to: 'in_progress', agent: null, autoRefine: false, mode: 'refine', requireApproval: false },
  { from: 'in_progress', to: 'done', agent: null, autoRefine: false, mode: 'refine', requireApproval: false },
  { from: 'in_progress', to: 'backlog', agent: null, autoRefine: false, mode: 'refine', requireApproval: false },
  { from: 'done', to: 'backlog', agent: null, autoRefine: false, mode: 'refine', requireApproval: false },
];

const DEFAULT_WORKFLOW = {
  columns: DEFAULT_COLUMNS,
  transitions: DEFAULT_TRANSITIONS,
  approvalAgent: '',
  version: 1,
};

// ── Persistence (PostgreSQL settings table, key = "workflow:<project>") ─────

function workflowKey(project) {
  return `workflow:${project || '_default'}`;
}

export async function getWorkflow(project) {
  const pool = getPool();
  if (!pool) return { ...DEFAULT_WORKFLOW };

  try {
    const result = await pool.query(
      'SELECT value FROM settings WHERE key = $1',
      [workflowKey(project)]
    );
    if (result.rows.length > 0 && result.rows[0].value) {
      return JSON.parse(result.rows[0].value);
    }
  } catch (err) {
    console.error('[Workflow] Failed to load workflow:', err.message);
  }
  return { ...DEFAULT_WORKFLOW };
}

export async function updateWorkflow(project, workflow) {
  const pool = getPool();
  if (!pool) throw new Error('Database not available');

  const data = { ...workflow, updatedAt: new Date().toISOString() };
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [workflowKey(project), JSON.stringify(data)]
  );
  return data;
}

export async function getAllWorkflows() {
  const pool = getPool();
  if (!pool) return {};

  try {
    const result = await pool.query(
      "SELECT key, value FROM settings WHERE key LIKE 'workflow:%'"
    );
    const workflows = {};
    for (const row of result.rows) {
      const project = row.key.replace('workflow:', '');
      try { workflows[project] = JSON.parse(row.value); } catch { /* skip */ }
    }
    return workflows;
  } catch (err) {
    console.error('[Workflow] Failed to load all workflows:', err.message);
    return {};
  }
}

/**
 * Check if a transition from fromStatus to toStatus is allowed.
 * Returns the transition config object or null if not allowed.
 */
export async function getTransitionConfig(project, fromStatus, toStatus) {
  const workflow = await getWorkflow(project);
  return workflow.transitions.find(t => t.from === fromStatus && t.to === toStatus) || null;
}
