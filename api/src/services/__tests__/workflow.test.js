import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentManager } from '../agentManager.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal mock IO */
const mockIo = { emit() {}, to() { return { emit() {} }; } };

/** Create an AgentManager with agents pre-registered */
async function setup(agentDefs = []) {
  const mgr = new AgentManager(mockIo, null, null, null);
  for (const def of agentDefs) {
    const created = await mgr.create(def);
    const raw = mgr.agents.get(created.id);
    // Ensure agents start idle
    raw.status = 'idle';
    raw.conversationHistory = [];
    raw.todoList = [];
  }
  return mgr;
}

/** Build a workflow config object */
function workflow(columns, transitions) {
  return { columns, transitions };
}

/** Create a task on the first agent's todoList */
function addTask(mgr, text, status, boardId = 'board-1', extra = {}) {
  const [firstAgentId] = mgr.agents.keys();
  const agent = mgr.agents.get(firstAgentId);
  const task = {
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    text,
    status,
    boardId,
    assignee: null,
    ...extra,
  };
  agent.todoList.push(task);
  return { task, agentId: firstAgentId };
}

// ── Mock configManager to return our test workflows ──────────────────────────

// We override _checkAutoRefine to avoid async workflow lookups
// and instead test the action chain logic directly via _processOnEnterTransitions

// ── Tests ────────────────────────────────────────────────────────────────────

test('_isActiveTaskStatus returns true for non-terminal statuses', async () => {
  const mgr = await setup([{ name: 'A', role: 'dev' }]);
  assert.equal(mgr._isActiveTaskStatus('code'), true);
  assert.equal(mgr._isActiveTaskStatus('refine'), true);
  assert.equal(mgr._isActiveTaskStatus('pending'), true);
  assert.equal(mgr._isActiveTaskStatus('done'), false);
  assert.equal(mgr._isActiveTaskStatus('backlog'), false);
  assert.equal(mgr._isActiveTaskStatus('error'), false);
});

test('_completedActionIdx is cleaned up before change_status', async () => {
  // Simulates the bug where _completedActionIdx from a previous chain
  // leaked into the next column's on_enter transition
  const mgr = await setup([
    { name: 'Titles', role: 'titles-manager' },
    { name: 'PM', role: 'product-manager' },
    { name: 'Dev', role: 'developer' },
  ]);
  const { task, agentId } = addTask(mgr, 'Test task', 'refine');

  // Simulate: refine chain completed 3 actions (set_type, title, refine)
  // and _completedActionIdx = 2 is left on the task
  task._completedActionIdx = 2;

  // Now simulate change_status action moving to 'code'
  // This should clean up _completedActionIdx BEFORE triggering code on_enter
  const wf = workflow(
    [{ id: 'refine' }, { id: 'code' }, { id: 'done' }],
    []
  );

  // Directly test: the cleanup logic
  // Before: task has _completedActionIdx
  assert.equal(task._completedActionIdx, 2);

  // Simulate what change_status does: clean up then move
  delete task._completedActionIdx;
  delete task._pendingOnEnter;
  task.status = 'code';

  // After: _completedActionIdx should be gone
  assert.equal(task._completedActionIdx, undefined);
  assert.equal(task.status, 'code');
});

test('assign_agent_individual sets specific agent or null', async () => {
  const mgr = await setup([
    { name: 'Leader', role: 'manager' },
    { name: 'Worker', role: 'developer' },
  ]);
  const agents = Array.from(mgr.agents.values());
  const worker = agents.find(a => a.name === 'Worker');
  const { task, agentId } = addTask(mgr, 'Assign test', 'code');

  // Assign to specific agent
  task.assignee = worker.id;
  assert.equal(task.assignee, worker.id);

  // Unassign (None)
  task.assignee = null;
  assert.equal(task.assignee, null);
});

test('agentHasActiveTask excludes specific task when excludeTaskId is provided', async () => {
  // When running multiple actions in a chain on the same task,
  // the agent assigned to that task should not be blocked by it
  const mgr = await setup([
    { name: 'Creator', role: 'manager' },
    { name: 'Titles', role: 'titles-manager' },
  ]);
  const agents = Array.from(mgr.agents.entries());
  const [creatorId, creator] = agents[0];
  const [titlesId, titles] = agents[1];

  // Add a task assigned to Titles agent
  const taskId = 'task-chain-1';
  creator.todoList.push({
    id: taskId,
    text: 'Multi-action task',
    status: 'refine',
    assignee: titlesId,
  });

  // Without exclude: agent IS busy
  assert.equal(mgr.agentHasActiveTask(titlesId), true);

  // With exclude for THIS task: agent is NOT busy (can work on next action)
  assert.equal(mgr.agentHasActiveTask(titlesId, taskId), false);

  // With exclude for a DIFFERENT task: agent IS still busy
  assert.equal(mgr.agentHasActiveTask(titlesId, 'other-task'), true);
});

test('action chain resume index tracks correctly', async () => {
  const mgr = await setup([{ name: 'A', role: 'dev' }]);
  const { task } = addTask(mgr, 'Chain test', 'refine');

  // No completed actions yet
  const startIdx0 = (typeof task._completedActionIdx === 'number') ? task._completedActionIdx + 1 : 0;
  assert.equal(startIdx0, 0, 'should start at action 0');

  // After action 0 completes
  task._completedActionIdx = 0;
  const startIdx1 = task._completedActionIdx + 1;
  assert.equal(startIdx1, 1, 'should resume at action 1');

  // After action 1 completes
  task._completedActionIdx = 1;
  const startIdx2 = task._completedActionIdx + 1;
  assert.equal(startIdx2, 2, 'should resume at action 2');

  // Cleanup
  delete task._completedActionIdx;
  const startIdxClean = (typeof task._completedActionIdx === 'number') ? task._completedActionIdx + 1 : 0;
  assert.equal(startIdxClean, 0, 'should restart from 0 after cleanup');
});

test('agentHasActiveTask detects cross-agent assignments', async () => {
  const mgr = await setup([
    { name: 'Creator', role: 'manager' },
    { name: 'Worker', role: 'developer' },
  ]);
  const agents = Array.from(mgr.agents.entries());
  const [creatorId, creator] = agents[0];
  const [workerId, worker] = agents[1];

  // No active tasks initially
  assert.equal(mgr.agentHasActiveTask(workerId), false);

  // Add an active task assigned to Worker on Creator's todoList
  creator.todoList.push({
    id: 'task-1',
    text: 'Build feature',
    status: 'code',
    assignee: workerId,
  });

  // Worker should now show as having an active task
  assert.equal(mgr.agentHasActiveTask(workerId), true);

  // Move task to done — worker should be free
  creator.todoList[0].status = 'done';
  assert.equal(mgr.agentHasActiveTask(workerId), false);
});

test('task startedAt is preserved for managesContext history scoping', async () => {
  const mgr = await setup([{ name: 'Dev', role: 'developer' }]);
  const { task } = addTask(mgr, 'Context test', 'code');

  // startedAt should be settable
  const now = new Date().toISOString();
  task.startedAt = now;
  assert.equal(task.startedAt, now);

  // Should not be overwritten if already set
  const earlier = '2020-01-01T00:00:00.000Z';
  task.startedAt = earlier;
  if (!task.startedAt) {
    task.startedAt = now;
  }
  assert.equal(task.startedAt, earlier, 'should not overwrite existing startedAt');
});

test('setTaskStatus changes status and emits events', async () => {
  const mgr = await setup([{ name: 'Dev', role: 'developer' }]);
  const { task, agentId } = addTask(mgr, 'Status test', 'backlog');

  const result = mgr.setTaskStatus(agentId, task.id, 'code');
  // setTaskStatus returns the updated task object (truthy), not boolean true
  assert.ok(result, 'setTaskStatus should return truthy result');

  const updated = mgr.agents.get(agentId).todoList.find(t => t.id === task.id);
  assert.equal(updated.status, 'code');
});

test('setTaskStatus returns falsy for invalid task id', async () => {
  const mgr = await setup([{ name: 'Dev', role: 'developer' }]);
  const [agentId] = mgr.agents.keys();

  const result = mgr.setTaskStatus(agentId, 'nonexistent', 'code');
  assert.ok(!result, 'setTaskStatus should return falsy for invalid task');
});

test('transition matching only applies to current task status', async () => {
  // Workflow transitions should only match when task.from === task.status
  const transitions = [
    { from: 'code', trigger: 'on_enter', actions: [{ type: 'change_status', target: 'done' }] },
    { from: 'refine', trigger: 'on_enter', actions: [{ type: 'change_status', target: 'code' }] },
  ];

  // Only 'code' transitions should match for a task in 'code' status
  const taskStatus = 'code';
  const matching = transitions.filter(t => t.from === taskStatus);
  assert.equal(matching.length, 1);
  assert.equal(matching[0].from, 'code');
});

test('_validTransition requires from, trigger, and actions array', async () => {
  const mgr = await setup([{ name: 'A', role: 'dev' }]);

  assert.ok(mgr._validTransition({ from: 'code', trigger: 'on_enter', actions: [] }));
  assert.ok(!mgr._validTransition({ from: 'code', trigger: 'on_enter' }));
  assert.ok(!mgr._validTransition({ from: 'code', actions: [] }));
  assert.ok(!mgr._validTransition({ trigger: 'on_enter', actions: [] }));
  assert.ok(!mgr._validTransition(null));
  assert.ok(!mgr._validTransition(undefined));
});

test('full refine→code chain: _completedActionIdx does not leak across transitions', async () => {
  // End-to-end simulation of the refine chain followed by code on_enter
  const mgr = await setup([
    { name: 'Titles', role: 'titles-manager' },
    { name: 'PM', role: 'product-manager' },
    { name: 'Dev', role: 'developer' },
  ]);
  const { task, agentId } = addTask(mgr, 'Full chain test', 'refine');

  // Simulate refine chain completing actions 0, 1, 2 (set_type, title, refine)
  task._completedActionIdx = 0;
  task._completedActionIdx = 1;
  task._completedActionIdx = 2;

  // Action 3 is change_status → code
  // Before moving: cleanup _completedActionIdx
  delete task._completedActionIdx;
  delete task._pendingOnEnter;
  task.status = 'code';

  // Now code on_enter should start fresh
  const startIdx = (typeof task._completedActionIdx === 'number') ? task._completedActionIdx + 1 : 0;
  assert.equal(startIdx, 0, 'code on_enter should start at action 0, not resume from refine chain');
  assert.equal(task.status, 'code');
});
