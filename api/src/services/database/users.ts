import { db } from './connection.js';
import { generateUuid } from '../../utils/uuid.js';
import { canonicalizeRole } from '../authorization.js';
import type { Permission } from '../authorization.js';
import bcrypt from 'bcryptjs';

export type UserRole = 'admin' | 'advanced' | 'basic';

export interface User {
  id: string;
  email: string;
  username: string;
  role: UserRole;
  permissions?: Permission[] | null;
  passwordHash?: string | null;
  googleId?: string | null;
  microsoftId?: string | null;
  githubId?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DbUser {
  id: string;
  email: string;
  username: string;
  role: UserRole;
  permissions: string | null;
  password_hash: string | null;
  google_id: string | null;
  microsoft_id: string | null;
  github_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapDbUser(row: DbUser): User {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    role: canonicalizeRole(row.role),
    permissions: row.permissions ? JSON.parse(row.permissions) : null,
    passwordHash: row.password_hash,
    googleId: row.google_id,
    microsoftId: row.microsoft_id,
    githubId: row.github_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getUserById(id: string): Promise<User | null> {
  const result = await db.query<DbUser>(
    'SELECT * FROM users WHERE id = $1',
    [id]
  );
  return result.rows[0] ? mapDbUser(result.rows[0]) : null;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const result = await db.query<DbUser>(
    'SELECT * FROM users WHERE LOWER(email) = LOWER($1)',
    [email]
  );
  return result.rows[0] ? mapDbUser(result.rows[0]) : null;
}

export async function getUserByGoogleId(googleId: string): Promise<User | null> {
  const result = await db.query<DbUser>(
    'SELECT * FROM users WHERE google_id = $1',
    [googleId]
  );
  return result.rows[0] ? mapDbUser(result.rows[0]) : null;
}

export async function getUserByGitHubId(githubId: string): Promise<User | null> {
  const result = await db.query<DbUser>(
    'SELECT * FROM users WHERE github_id = $1',
    [githubId]
  );
  return result.rows[0] ? mapDbUser(result.rows[0]) : null;
}

export async function getUserByMicrosoftId(microsoftId: string): Promise<User | null> {
  const result = await db.query<DbUser>(
    'SELECT * FROM users WHERE microsoft_id = $1',
    [microsoftId]
  );
  return result.rows[0] ? mapDbUser(result.rows[0]) : null;
}

export async function createGitHubUser(githubId: string, email: string, username: string, role: UserRole = 'basic'): Promise<User> {
  const id = generateUuid();
  const result = await db.query<DbUser>(
    `INSERT INTO users (id, email, username, role, github_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     RETURNING *`,
    [id, email, username, role, githubId]
  );
  return mapDbUser(result.rows[0]);
}

export async function linkGitHubId(userId: string, githubId: string): Promise<void> {
  await db.query('UPDATE users SET github_id = $1, updated_at = NOW() WHERE id = $2', [githubId, userId]);
}

export async function createMicrosoftUser(microsoftId: string, email: string, username: string, role: UserRole = 'basic'): Promise<User> {
  const id = generateUuid();
  const result = await db.query<DbUser>(
    `INSERT INTO users (id, email, username, role, microsoft_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     RETURNING *`,
    [id, email, username, role, microsoftId]
  );
  return mapDbUser(result.rows[0]);
}

export async function linkMicrosoftId(userId: string, microsoftId: string): Promise<void> {
  await db.query('UPDATE users SET microsoft_id = $1, updated_at = NOW() WHERE id = $2', [microsoftId, userId]);
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const result = await db.query<DbUser>(
    'SELECT * FROM users WHERE LOWER(username) = LOWER($1)',
    [username]
  );
  return result.rows[0] ? mapDbUser(result.rows[0]) : null;
}

export async function createGoogleUser(googleId: string, email: string, username: string, role: UserRole = 'basic'): Promise<User> {
  const id = generateUuid();
  const result = await db.query<DbUser>(
    `INSERT INTO users (id, email, username, role, google_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     RETURNING *`,
    [id, email, username, role, googleId]
  );
  return mapDbUser(result.rows[0]);
}

export async function linkGoogleId(userId: string, googleId: string): Promise<void> {
  await db.query('UPDATE users SET google_id = $1, updated_at = NOW() WHERE id = $2', [googleId, userId]);
}

export async function createUser(email: string, username: string, password: string, role: UserRole = 'basic'): Promise<User> {
  const id = generateUuid();
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await db.query<DbUser>(
    `INSERT INTO users (id, email, username, role, password_hash, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     RETURNING *`,
    [id, email, username, role, passwordHash]
  );
  return mapDbUser(result.rows[0]);
}

export async function updateUserPassword(userId: string, password: string): Promise<void> {
  const passwordHash = await bcrypt.hash(password, 10);
  await db.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [passwordHash, userId]);
}

export async function updateUserRole(userId: string, role: UserRole): Promise<void> {
  await db.query('UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2', [role, userId]);
}

export async function updateUserPermissions(userId: string, permissions: Permission[] | null): Promise<void> {
  const value = permissions ? JSON.stringify(permissions) : null;
  await db.query('UPDATE users SET permissions = $1, updated_at = NOW() WHERE id = $2', [value, userId]);
}

export async function deleteUser(userId: string): Promise<void> {
  await db.query('DELETE FROM users WHERE id = $1', [userId]);
}

export async function getAllUsers(): Promise<User[]> {
  const result = await db.query<DbUser>(
    `SELECT id, email, username, role, permissions, password_hash, google_id, microsoft_id, github_id, created_at, updated_at
     FROM users
     ORDER BY created_at ASC`
  );
  return result.rows.map(mapDbUser);
}

export async function verifyPassword(userId: string, password: string): Promise<boolean> {
  const result = await db.query<{ password_hash: string | null }>(
    'SELECT password_hash FROM users WHERE id = $1',
    [userId]
  );
  const hash = result.rows[0]?.password_hash;
  if (!hash) return false;
  return bcrypt.compare(hash, password);
}