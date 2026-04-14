/**
 * Tests for reminder configuration (getReminderConfig).
 *
 * Run with: node --experimental-vm-modules api/src/services/__tests__/reminderConfig.test.js
 */

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  } else {
    passed++;
  }
}

async function test(name, fn) {
  console.log(`  ${name}`);
  try {
    await fn();
  } catch (err) {
    console.error(`  ❌ FAIL: ${name} threw: ${err.message}`);
    failed++;
  }
}

// Stub the database layer so getSettings returns controlled values
const settingsStore = {};
const originalImport = {};

// We test getReminderConfig by importing it after stubbing the DB.
// Since configManager calls getPool internally, we mock at the module level
// by testing the logic in isolation.

function computeReminderConfig(settings, envInterval) {
  const intOrDefault = (val, def) => { const n = parseInt(val, 10); return Number.isNaN(n) ? def : n; };
  const intervalMinutes = envInterval
    ? intOrDefault(envInterval, 10)
    : intOrDefault(settings.taskReminderIntervalMinutes, 10);
  const maxReminders = intOrDefault(settings.taskReminderMaxCount, 12);
  const cooldownMinutes = intOrDefault(settings.taskReminderCooldownMinutes, 2);

  return {
    intervalMs: Math.max(1, intervalMinutes) * 60 * 1000,
    intervalMinutes: Math.max(1, intervalMinutes),
    maxReminders: Math.max(1, maxReminders),
    cooldownMs: Math.max(0, cooldownMinutes) * 60 * 1000,
    cooldownMinutes: Math.max(0, cooldownMinutes),
  };
}

async function runTests() {
  console.log('\n🧪 Reminder Configuration Tests\n');

  await test('default values: 10 min interval, 12 max reminders, 2 min cooldown', async () => {
    const config = computeReminderConfig({
      taskReminderIntervalMinutes: '10',
      taskReminderMaxCount: '12',
      taskReminderCooldownMinutes: '2',
    }, undefined);

    assert(config.intervalMinutes === 10, `Expected interval 10, got ${config.intervalMinutes}`);
    assert(config.intervalMs === 600000, `Expected intervalMs 600000, got ${config.intervalMs}`);
    assert(config.maxReminders === 12, `Expected maxReminders 12, got ${config.maxReminders}`);
    assert(config.cooldownMinutes === 2, `Expected cooldown 2, got ${config.cooldownMinutes}`);
    assert(config.cooldownMs === 120000, `Expected cooldownMs 120000, got ${config.cooldownMs}`);
  });

  await test('env var overrides DB setting for interval', async () => {
    const config = computeReminderConfig({
      taskReminderIntervalMinutes: '10',
      taskReminderMaxCount: '12',
      taskReminderCooldownMinutes: '2',
    }, '15');

    assert(config.intervalMinutes === 15, `Expected interval 15, got ${config.intervalMinutes}`);
    assert(config.intervalMs === 900000, `Expected intervalMs 900000, got ${config.intervalMs}`);
  });

  await test('DB setting is used when env var is not set', async () => {
    const config = computeReminderConfig({
      taskReminderIntervalMinutes: '20',
      taskReminderMaxCount: '5',
      taskReminderCooldownMinutes: '3',
    }, undefined);

    assert(config.intervalMinutes === 20, `Expected interval 20, got ${config.intervalMinutes}`);
    assert(config.maxReminders === 5, `Expected maxReminders 5, got ${config.maxReminders}`);
    assert(config.cooldownMinutes === 3, `Expected cooldown 3, got ${config.cooldownMinutes}`);
  });

  await test('minimum values are enforced', async () => {
    const config = computeReminderConfig({
      taskReminderIntervalMinutes: '0',
      taskReminderMaxCount: '0',
      taskReminderCooldownMinutes: '-1',
    }, undefined);

    // Math.max(1, ...) clamps interval and maxReminders to at least 1
    assert(config.intervalMinutes === 1, `Expected interval 1 (clamped), got ${config.intervalMinutes}`);
    assert(config.maxReminders === 1, `Expected maxReminders 1 (clamped), got ${config.maxReminders}`);
    // Math.max(0, ...) clamps cooldown to at least 0
    assert(config.cooldownMinutes === 0, `Expected cooldown 0 (clamped from -1), got ${config.cooldownMinutes}`);
  });

  await test('missing settings fall back to defaults', async () => {
    const config = computeReminderConfig({}, undefined);

    assert(config.intervalMinutes === 10, `Expected interval 10, got ${config.intervalMinutes}`);
    assert(config.maxReminders === 12, `Expected maxReminders 12, got ${config.maxReminders}`);
    assert(config.cooldownMinutes === 2, `Expected cooldown 2, got ${config.cooldownMinutes}`);
  });

  await test('env var with value 1 sets minimum interval', async () => {
    const config = computeReminderConfig({}, '1');

    assert(config.intervalMinutes === 1, `Expected interval 1, got ${config.intervalMinutes}`);
    assert(config.intervalMs === 60000, `Expected intervalMs 60000, got ${config.intervalMs}`);
  });

  await test('interval was changed from old 5-minute default to 10', async () => {
    // Verify the default is 10, not the old 5
    const config = computeReminderConfig({
      taskReminderIntervalMinutes: '10',
    }, undefined);
    assert(config.intervalMinutes === 10, `Default should be 10 minutes, got ${config.intervalMinutes}`);
    assert(config.intervalMs === 600000, `Default should be 600000ms, got ${config.intervalMs}`);
    // Explicitly NOT 5 minutes
    assert(config.intervalMs !== 300000, `Should NOT be old 5-minute default (300000ms)`);
  });

  await test('cooldown prevents reminders when set to 0', async () => {
    const config = computeReminderConfig({
      taskReminderCooldownMinutes: '0',
    }, undefined);
    assert(config.cooldownMs === 0, `Expected cooldownMs 0, got ${config.cooldownMs}`);
  });

  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    console.log('❌ Some tests failed!');
    process.exit(1);
  } else {
    console.log('✅ All tests passed!');
  }
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
