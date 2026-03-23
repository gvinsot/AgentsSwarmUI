import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { CodeIndexService } from '../codeIndexService.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TEST_DATA_DIR = path.join(os.tmpdir(), 'code-index-data-' + Date.now());
const FIXTURE_DIR = path.join(os.tmpdir(), 'code-index-test-' + Date.now());

function makeService() {
  return new CodeIndexService({
    storageRoot: TEST_DATA_DIR,
    allowedRoots: [FIXTURE_DIR, os.tmpdir()],
  });
}

const FIXTURES = {
  'src/auth.js': `
import jwt from 'jsonwebtoken';
/**
 * Authenticate a JWT token from the request header
 */
export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

export function generateToken(userId, email) {
  return jwt.sign({ id: userId, email }, process.env.JWT_SECRET, { expiresIn: '24h' });
}

export class AuthService {
  constructor(secret) { this.secret = secret; }
  validateUser(username, password) { return { id: 1, username }; }
  refreshToken(oldToken) { return this.generateNewToken(jwt.decode(oldToken)); }
  generateNewToken(payload) { return jwt.sign(payload, this.secret, { expiresIn: '1h' }); }
}
`,
  'src/database.py': `
import sqlite3
from contextlib import contextmanager

class Database:
    """Database connection manager"""
    def __init__(self, db_path):
        self.db_path = db_path

    @contextmanager
    def connection(self):
        conn = sqlite3.connect(self.db_path)
        try:
            yield conn
        finally:
            conn.close()

    def execute_query(self, sql, params=None):
        with self.connection() as conn:
            cursor = conn.cursor()
            cursor.execute(sql, params or [])
            return cursor.fetchall()

def create_tables(db):
    db.execute_query("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT)")
`,
  'src/utils/helpers.ts': `
export interface Config { apiUrl: string; timeout: number; }
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
export function formatDuration(ms: number): string {
  if (ms < 1000) return ms + 'ms';
  const seconds = Math.floor(ms / 1000);
  return seconds + 's';
}
export function debounce<T extends (...args: any[]) => any>(fn: T, delay: number): T {
  let timer: NodeJS.Timeout;
  return ((...args: any[]) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); }) as T;
}
`,
  'src/empty.js': '',
};

before(() => {
  for (const [relPath, content] of Object.entries(FIXTURES)) {
    const absPath = path.join(FIXTURE_DIR, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content);
  }
});

after(() => {
  fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

describe('CodeIndexService', () => {
  it('should index a folder and return stats', () => {
    const service = makeService();
    const result = service.indexFolder(FIXTURE_DIR, 'test-repo');
    assert.ok(result.repoId, 'Should have repoId');
    assert.ok(result.filesIndexed > 0, 'Should index files');
    assert.ok(result.symbolCount > 0, 'Should find symbols');
  });

  it('should list indexed repos', () => {
    const service = makeService();
    service.indexFolder(FIXTURE_DIR, 'test-list');
    const repos = service.listRepos();
    assert.ok(repos.length > 0);
    assert.ok(repos[0].repoId, 'Should have repoId');
  });

  it('should return file tree', () => {
    const service = makeService();
    const result = service.indexFolder(FIXTURE_DIR, 'test-tree');
    const tree = service.getFileTree(result.repoId);
    assert.ok(tree);
    assert.ok(tree.children && tree.children.length > 0, 'Tree should have children');
    const allNames = JSON.stringify(tree);
    assert.ok(allNames.includes('auth.js'), 'Should contain auth.js');
  });

  it('should return file outline with symbols', () => {
    const service = makeService();
    const result = service.indexFolder(FIXTURE_DIR, 'test-outline');
    const outline = service.getFileOutline(result.repoId, 'src/auth.js');
    assert.ok(outline);
    assert.ok(outline.length > 0);
    const names = outline.map(s => s.name);
    assert.ok(names.includes('authenticateToken'), 'Should find authenticateToken');
  });

  it('should search symbols by name', () => {
    const service = makeService();
    const result = service.indexFolder(FIXTURE_DIR, 'test-search');
    const results = service.searchSymbols(result.repoId, 'authenticate');
    assert.ok(results.length > 0, 'Should find matching symbols');
    assert.ok(results[0].name.toLowerCase().includes('authenticate'));
  });

  it('should return empty for no matches', () => {
    const service = makeService();
    const result = service.indexFolder(FIXTURE_DIR, 'test-no-match');
    const results = service.searchSymbols(result.repoId, 'xyzNonExistent123');
    assert.deepEqual(results, []);
  });

  it('should search semantically', () => {
    const service = makeService();
    const result = service.indexFolder(FIXTURE_DIR, 'test-semantic');
    const results = service.searchSemantic(result.repoId, 'JWT authentication middleware');
    assert.ok(results.length > 0);
    const allText = results.map(r => (r.name + ' ' + (r.summary || '')).toLowerCase()).join(' ');
    assert.ok(/auth|token|jwt/.test(allText), 'Should find auth-related symbols');
  });

  it('should search text', () => {
    const service = makeService();
    const result = service.indexFolder(FIXTURE_DIR, 'test-text');
    const results = service.searchText(result.repoId, 'jwt.verify');
    assert.ok(results.length > 0);
  });

  it('should retrieve symbol source code', () => {
    const service = makeService();
    const result = service.indexFolder(FIXTURE_DIR, 'test-symbol');
    const symbols = service.searchSymbols(result.repoId, 'authenticateToken');
    assert.ok(symbols.length > 0);
    const detail = service.getSymbol(result.repoId, symbols[0].id);
    assert.ok(detail);
    assert.ok(detail.source.includes('jwt.verify'));
  });

  it('should index Python files', () => {
    const service = makeService();
    const result = service.indexFolder(FIXTURE_DIR, 'test-py');
    const results = service.searchSymbols(result.repoId, 'Database');
    assert.ok(results.length > 0);
  });

  it('should index TypeScript files', () => {
    const service = makeService();
    const result = service.indexFolder(FIXTURE_DIR, 'test-ts');
    const results = service.searchSymbols(result.repoId, 'formatDuration');
    assert.ok(results.length > 0);
  });

  it('should reduce tokens vs full file for targeted queries', () => {
    const service = makeService();
    const result = service.indexFolder(FIXTURE_DIR, 'test-tokens');
    const fullFile = fs.readFileSync(path.join(FIXTURE_DIR, 'src/auth.js'), 'utf8');
    const fullTokens = fullFile.length / 4;
    const results = service.searchSymbols(result.repoId, 'authenticateToken', { topK: 1 });
    assert.equal(results.length, 1);
    const sym = service.getSymbol(result.repoId, results[0].id);
    const indexedTokens = sym.source.length / 4;
    const reduction = 1 - (indexedTokens / fullTokens);
    console.log(`  Token reduction: ${(reduction * 100).toFixed(1)}% (full: ~${Math.round(fullTokens)}, indexed: ~${Math.round(indexedTokens)})`);
    assert.ok(reduction > 0.3, `Expected >30% reduction, got ${(reduction*100).toFixed(1)}%`);
  });

  it('should reduce tokens vs full codebase for semantic queries', () => {
    const service = makeService();
    const result = service.indexFolder(FIXTURE_DIR, 'test-tokens-sem');
    let total = '';
    for (const [p, c] of Object.entries(FIXTURES)) {
      if (p.endsWith('.js') || p.endsWith('.py') || p.endsWith('.ts')) total += c;
    }
    const fullTokens = total.length / 4;
    const results = service.searchSemantic(result.repoId, 'authentication', { topK: 3 });
    let indexed = '';
    for (const r of results) {
      const s = service.getSymbol(result.repoId, r.id);
      if (s) indexed += s.source;
    }
    const indexedTokens = indexed.length / 4;
    const reduction = 1 - (indexedTokens / fullTokens);
    console.log(`  Codebase token reduction: ${(reduction * 100).toFixed(1)}% (full: ~${Math.round(fullTokens)}, indexed: ~${Math.round(indexedTokens)})`);
    assert.ok(reduction > 0.5, `Expected >50% reduction, got ${(reduction*100).toFixed(1)}%`);
  });

  it('should index in under 1 second', () => {
    const service = makeService();
    const start = Date.now();
    service.indexFolder(FIXTURE_DIR, 'test-perf');
    const elapsed = Date.now() - start;
    console.log(`  Indexing time: ${elapsed}ms`);
    assert.ok(elapsed < 1000);
  });

  it('should handle repo not found', () => {
    const service = makeService();
    const tree = service.getFileTree('nonexistent');
    assert.equal(tree, null);
  });

  it('should handle symbol not found', () => {
    const service = makeService();
    const result = service.indexFolder(FIXTURE_DIR, 'test-edge');
    const sym = service.getSymbol(result.repoId, 'nonexistent-id');
    assert.equal(sym, null);
  });
});