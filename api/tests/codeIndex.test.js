import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { CodeIndexService } from '../src/services/codeIndex.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ── Test fixtures ──────────────────────────────────────────────────────────────

const FIXTURE_DIR = path.join(os.tmpdir(), 'code-index-test-' + Date.now());

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
  constructor(secret) {
    this.secret = secret;
  }

  validateUser(username, password) {
    // validate credentials
    return { id: 1, username };
  }

  refreshToken(oldToken) {
    const decoded = jwt.decode(oldToken);
    return this.generateNewToken(decoded);
  }

  generateNewToken(payload) {
    return jwt.sign(payload, this.secret, { expiresIn: '1h' });
  }
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

    def insert_record(self, table, data):
        columns = ', '.join(data.keys())
        placeholders = ', '.join(['?' for _ in data])
        sql = f"INSERT INTO {table} ({columns}) VALUES ({placeholders})"
        return self.execute_query(sql, list(data.values()))

def create_tables(db):
    db.execute_query("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            username TEXT NOT NULL,
            email TEXT UNIQUE
        )
    """)
`,
  'src/utils/helpers.ts': `
export interface Config {
  apiUrl: string;
  timeout: number;
  retryCount: number;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export function formatDuration(ms: number): string {
  if (ms < 1000) return ms + 'ms';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return seconds + 's';
  const minutes = Math.floor(seconds / 60);
  return minutes + 'm ' + (seconds % 60) + 's';
}

export function debounce<T extends (...args: any[]) => any>(fn: T, delay: number): T {
  let timer: NodeJS.Timeout;
  return ((...args: any[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  }) as T;
}

export const DEFAULT_CONFIG: Config = {
  apiUrl: 'https://api.example.com',
  timeout: 5000,
  retryCount: 3,
};
`,
  'src/empty.js': '',
  'README.md': '# Test Project\\nA sample project for testing the code indexer.',
};

// ── Setup / Teardown ───────────────────────────────────────────────────────────

beforeAll(() => {
  for (const [relPath, content] of Object.entries(FIXTURES)) {
    const absPath = path.join(FIXTURE_DIR, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content);
  }
});

afterAll(() => {
  fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('CodeIndexService', () => {
  let service;
  let repoId;

  beforeEach(() => {
    service = new CodeIndexService();
  });

  describe('indexFolder', () => {
    it('should index a folder and return stats', () => {
      const result = service.indexFolder(FIXTURE_DIR, 'test-repo');
      repoId = result.repoId;
      expect(result.repoId).toBe('test-repo');
      expect(result.filesIndexed).toBeGreaterThan(0);
      expect(result.symbolCount).toBeGreaterThan(0);
    });

    it('should handle empty files gracefully', () => {
      const result = service.indexFolder(FIXTURE_DIR, 'test-empty');
      expect(result.filesIndexed).toBeGreaterThan(0);
      // Empty file should not cause crash
    });

    it('should respect maxFiles limit', () => {
      const result = service.indexFolder(FIXTURE_DIR, 'test-limited', { maxFiles: 1 });
      expect(result.filesIndexed).toBeLessThanOrEqual(1);
    });

    it('should not crash on non-existent folder', () => {
      expect(() => service.indexFolder('/nonexistent/path', 'test-missing')).toThrow();
    });
  });

  describe('listRepos', () => {
    it('should list indexed repos', () => {
      service.indexFolder(FIXTURE_DIR, 'test-list');
      const repos = service.listRepos();
      expect(repos.length).toBeGreaterThan(0);
      expect(repos[0].repoId).toBe('test-list');
    });
  });

  describe('getFileTree', () => {
    it('should return file tree for indexed repo', () => {
      service.indexFolder(FIXTURE_DIR, 'test-tree');
      const tree = service.getFileTree('test-tree');
      expect(tree).toBeDefined();
      expect(tree.length).toBeGreaterThan(0);
      expect(tree.some(f => f.includes('auth.js'))).toBe(true);
    });
  });

  describe('getFileOutline', () => {
    it('should return symbols for a file', () => {
      service.indexFolder(FIXTURE_DIR, 'test-outline');
      const outline = service.getFileOutline('test-outline', 'src/auth.js');
      expect(outline).toBeDefined();
      expect(outline.length).toBeGreaterThan(0);
      const names = outline.map(s => s.name);
      expect(names).toContain('authenticateToken');
    });
  });

  describe('searchSymbols', () => {
    it('should find symbols by name', () => {
      service.indexFolder(FIXTURE_DIR, 'test-search');
      const results = service.searchSymbols('test-search', 'authenticate');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name.toLowerCase()).toContain('authenticate');
    });

    it('should find class methods', () => {
      service.indexFolder(FIXTURE_DIR, 'test-search-class');
      const results = service.searchSymbols('test-search-class', 'AuthService');
      expect(results.length).toBeGreaterThan(0);
    });

    it('should return empty array for no matches', () => {
      service.indexFolder(FIXTURE_DIR, 'test-search-empty');
      const results = service.searchSymbols('test-search-empty', 'xyzNonExistent123');
      expect(results).toEqual([]);
    });

    it('should respect topK limit', () => {
      service.indexFolder(FIXTURE_DIR, 'test-search-topk');
      const results = service.searchSymbols('test-search-topk', 'e', { topK: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe('searchSemantic', () => {
    it('should find code by semantic meaning', () => {
      service.indexFolder(FIXTURE_DIR, 'test-semantic');
      const results = service.searchSemantic('test-semantic', 'JWT authentication middleware');
      expect(results.length).toBeGreaterThan(0);
      // Should find auth-related symbols
      const allText = results.map(r => (r.name + ' ' + (r.summary || '')).toLowerCase()).join(' ');
      expect(allText).toMatch(/auth|token|jwt/);
    });

    it('should find database-related code', () => {
      service.indexFolder(FIXTURE_DIR, 'test-semantic-db');
      const results = service.searchSemantic('test-semantic-db', 'database connection management');
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('searchText', () => {
    it('should find exact text matches', () => {
      service.indexFolder(FIXTURE_DIR, 'test-text');
      const results = service.searchText('test-text', 'jwt.verify');
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('getSymbol', () => {
    it('should retrieve symbol source code', () => {
      service.indexFolder(FIXTURE_DIR, 'test-symbol');
      const symbols = service.searchSymbols('test-symbol', 'authenticateToken');
      expect(symbols.length).toBeGreaterThan(0);
      const symbolId = symbols[0].id;
      const detail = service.getSymbol('test-symbol', symbolId);
      expect(detail).toBeDefined();
      expect(detail.body).toContain('jwt.verify');
    });
  });

  describe('multi-language support', () => {
    it('should index JavaScript files', () => {
      service.indexFolder(FIXTURE_DIR, 'test-lang-js');
      const results = service.searchSymbols('test-lang-js', 'generateToken');
      expect(results.length).toBeGreaterThan(0);
    });

    it('should index Python files', () => {
      service.indexFolder(FIXTURE_DIR, 'test-lang-py');
      const results = service.searchSymbols('test-lang-py', 'Database');
      expect(results.length).toBeGreaterThan(0);
    });

    it('should index TypeScript files', () => {
      service.indexFolder(FIXTURE_DIR, 'test-lang-ts');
      const results = service.searchSymbols('test-lang-ts', 'formatDuration');
      expect(results.length).toBeGreaterThan(0);
    });

    it('should extract TypeScript interfaces', () => {
      service.indexFolder(FIXTURE_DIR, 'test-lang-ts-iface');
      const results = service.searchSymbols('test-lang-ts-iface', 'Config');
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('token efficiency', () => {
    it('should return less content than full file for targeted queries', () => {
      service.indexFolder(FIXTURE_DIR, 'test-tokens');

      // Baseline: full file content
      const fullFileContent = fs.readFileSync(path.join(FIXTURE_DIR, 'src/auth.js'), 'utf8');
      const fullFileTokenEstimate = fullFileContent.length / 4; // rough ~4 chars/token

      // Indexed: search for specific symbol
      const results = service.searchSymbols('test-tokens', 'authenticateToken', { topK: 1 });
      expect(results.length).toBe(1);
      const symbol = service.getSymbol('test-tokens', results[0].id);
      const indexedTokenEstimate = symbol.body.length / 4;

      // The indexed result should be significantly smaller than the full file
      const reduction = 1 - (indexedTokenEstimate / fullFileTokenEstimate);
      console.log(`Token reduction: ${(reduction * 100).toFixed(1)}% (full: ~${Math.round(fullFileTokenEstimate)} tokens, indexed: ~${Math.round(indexedTokenEstimate)} tokens)`);
      expect(reduction).toBeGreaterThan(0.3); // At least 30% reduction
    });

    it('should return less content than full codebase for semantic queries', () => {
      service.indexFolder(FIXTURE_DIR, 'test-tokens-semantic');

      // Baseline: all file contents
      let totalContent = '';
      for (const [relPath, content] of Object.entries(FIXTURES)) {
        if (relPath.endsWith('.js') || relPath.endsWith('.py') || relPath.endsWith('.ts')) {
          totalContent += content;
        }
      }
      const fullCodebaseTokenEstimate = totalContent.length / 4;

      // Indexed: semantic search
      const results = service.searchSemantic('test-tokens-semantic', 'authentication', { topK: 3 });
      let indexedContent = '';
      for (const r of results) {
        const sym = service.getSymbol('test-tokens-semantic', r.id);
        if (sym) indexedContent += sym.body;
      }
      const indexedTokenEstimate = indexedContent.length / 4;

      const reduction = 1 - (indexedTokenEstimate / fullCodebaseTokenEstimate);
      console.log(`Codebase token reduction: ${(reduction * 100).toFixed(1)}% (full: ~${Math.round(fullCodebaseTokenEstimate)} tokens, indexed: ~${Math.round(indexedTokenEstimate)} tokens)`);
      expect(reduction).toBeGreaterThan(0.5); // At least 50% reduction vs full codebase
    });
  });

  describe('performance', () => {
    it('should index fixture folder in under 1 second', () => {
      const start = Date.now();
      service.indexFolder(FIXTURE_DIR, 'test-perf');
      const elapsed = Date.now() - start;
      console.log(`Indexing time: ${elapsed}ms for ${Object.keys(FIXTURES).length} files`);
      expect(elapsed).toBeLessThan(1000);
    });

    it('should search symbols in under 50ms', () => {
      service.indexFolder(FIXTURE_DIR, 'test-perf-search');
      const start = Date.now();
      service.searchSymbols('test-perf-search', 'authenticate');
      const elapsed = Date.now() - start;
      console.log(`Symbol search time: ${elapsed}ms`);
      expect(elapsed).toBeLessThan(50);
    });

    it('should search semantically in under 100ms', () => {
      service.indexFolder(FIXTURE_DIR, 'test-perf-semantic');
      const start = Date.now();
      service.searchSemantic('test-perf-semantic', 'JWT auth middleware');
      const elapsed = Date.now() - start;
      console.log(`Semantic search time: ${elapsed}ms`);
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe('edge cases', () => {
    it('should handle repo not found', () => {
      const tree = service.getFileTree('nonexistent');
      expect(tree).toBeNull();
    });

    it('should handle file not found in repo', () => {
      service.indexFolder(FIXTURE_DIR, 'test-edge');
      const outline = service.getFileOutline('test-edge', 'nonexistent.js');
      expect(outline).toBeDefined();
      expect(outline.length).toBe(0);
    });

    it('should handle symbol not found', () => {
      service.indexFolder(FIXTURE_DIR, 'test-edge-sym');
      const sym = service.getSymbol('test-edge-sym', 'nonexistent-id');
      expect(sym).toBeNull();
    });

    it('should handle re-indexing the same repo', () => {
      const r1 = service.indexFolder(FIXTURE_DIR, 'test-reindex');
      const r2 = service.indexFolder(FIXTURE_DIR, 'test-reindex');
      expect(r2.symbolCount).toBe(r1.symbolCount);
    });
  });
});