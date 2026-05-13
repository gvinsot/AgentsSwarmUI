import { Router } from 'express';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import {
  getUserById,
  getUserByEmail,
  getUserByUsername,
  createUser,
  verifyPassword,
  getUserByGoogleId,
  createGoogleUser,
  linkGoogleId,
  getUserByGitHubId,
  createGitHubUser,
  linkGitHubId,
  getUserByMicrosoftId,
  createMicrosoftUser,
  linkMicrosoftId,
  type UserRole,
  type User,
  getAllUsers,
} from '../services/database.js';
import { exchangeGitHubCodeForToken, fetchGitHubProfile, fetchGitHubPrimaryEmail } from '../utils/githubOauth.js';
import { exchangeMicrosoftCodeForToken, fetchMicrosoftProfile, isMicrosoftOAuthConfigured, getMicrosoftClientId } from '../utils/microsoftOauth.js';
import { canonicalizeRole } from '../services/authorization.js';
import type { Permission } from '../services/authorization.js';
import { getEnvOrDie } from '../utils/env.js';
import { generateUuid } from '../utils/uuid.js';
import { signJwt, type JwtPayload } from '../utils/jwt.js';
import { exchangeGoogleCodeForToken, fetchGoogleProfile } from '../utils/googleOauth.js';

const router = Router();

const COOKIE_NAME = 'auth_token';
const COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const issueAuthCookie = (res: Response, token: string) => {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_MS,
  });
};

const clearAuthCookie = (res: Response) => {
  res.clearCookie(COOKIE_NAME);
};

router.post('/auth/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/auth/google/status', (req, res) => {
  const enabled = Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
  res.json({ enabled, clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || null });
});

router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password required' });
    }
    const user = await getUserByEmail(email);
    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const ok = await verifyPassword(user.id, password);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const payload: JwtPayload = {
      userId: user.id,
      email: user.email,
      role: canonicalizeRole(user.role),
      permissions: user.permissions || undefined,
      scope: 'user',
    };
    const token = signJwt(payload);
    issueAuthCookie(res, token);
    res.json({ token, user: { id: user.id, email: user.email, username: user.username, role: user.role } });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

router.get('/auth/google/url', (req, res) => {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    return res.status(503).json({ error: 'Google OAuth not configured' });
  }
  const redirectUri = (req.query.redirect_uri as string) || '';
  if (!redirectUri) {
    return res.status(400).json({ error: 'redirect_uri required' });
  }
  const state = generateUuid();
  const scope = 'openid profile email';
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&state=${state}&prompt=select_account`;
  res.json({ url, state });
});

router.post('/auth/register', async (req, res) => {
  try {
    const { email, username, password } = req.body || {};
    if (!email || !username || !password) {
      return res.status(400).json({ error: 'email, username and password required' });
    }
    if ((await getUserByEmail(email)) || (await getUserByUsername(username))) {
      return res.status(409).json({ error: 'User already exists' });
    }
    const userCount = (await getAllUsers()).length;
    const role: UserRole = userCount === 0 ? 'admin' : 'advanced';
    const user = await createUser(email, username, password, role);
    const payload: JwtPayload = {
      userId: user.id,
      email: user.email,
      role: canonicalizeRole(user.role),
      permissions: user.permissions || undefined,
      scope: 'user',
    };
    const token = signJwt(payload);
    issueAuthCookie(res, token);
    res.json({ token, user: { id: user.id, email: user.email, username: user.username, role: user.role } });
  } catch (error: any) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/auth/google/callback', async (req, res) => {
  try {
    const { code, redirectUri } = req.body || {};
    if (!code || !redirectUri) {
      return res.status(400).json({ error: 'code and redirectUri required' });
    }
    const tokenData = await exchangeGoogleCodeForToken(code, redirectUri);
    const profile = await fetchGoogleProfile(tokenData.access_token);
    let user = await getUserByGoogleId(profile.googleId);
    if (!user) {
      const existing = await getUserByEmail(profile.email);
      if (existing) {
        await linkGoogleId(existing.id, profile.googleId);
        user = existing;
      } else {
        const userCount = (await getAllUsers()).length;
        const role: UserRole = userCount === 0 ? 'admin' : 'advanced';
        const username = (profile.email.split('@')[0] || 'user').replace(/[^a-zA-Z0-9_.-]/g, '_');
        user = await createGoogleUser(profile.googleId, profile.email, username, role);
      }
    }
    const payload: JwtPayload = {
      userId: user.id,
      email: user.email,
      role: canonicalizeRole(user.role),
      permissions: user.permissions || undefined,
      scope: 'user',
    };
    const token = signJwt(payload);
    issueAuthCookie(res, token);
    res.json({ token, user: { id: user.id, email: user.email, username: user.username, role: user.role } });
  } catch (error: any) {
    console.error('Google OAuth callback error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// GitHub OAuth flow
router.get('/auth/github/status', (req, res) => {
  const enabled = Boolean(process.env.GITHUB_OAUTH_CLIENT_ID && process.env.GITHUB_OAUTH_CLIENT_SECRET);
  res.json({ enabled, clientId: process.env.GITHUB_OAUTH_CLIENT_ID || null });
});

router.get('/auth/github/url', (req, res) => {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  if (!clientId) {
    return res.status(503).json({ error: 'GitHub OAuth not configured' });
  }
  const redirectUri = (req.query.redirect_uri as string) || '';
  if (!redirectUri) {
    return res.status(400).json({ error: 'redirect_uri required' });
  }
  const state = generateUuid();
  const scope = 'read:user user:email';
  const url = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${state}&allow_signup=true`;
  res.json({ url, state });
});

router.post('/auth/github/callback', async (req, res) => {
  try {
    const { code, redirectUri } = req.body || {};
    if (!code || !redirectUri) {
      return res.status(400).json({ error: 'code and redirectUri required' });
    }
    const tokenData = await exchangeGitHubCodeForToken(code, redirectUri);
    const profile = await fetchGitHubProfile(tokenData.access_token);
    let email = profile.email;
    if (!email) {
      email = await fetchGitHubPrimaryEmail(tokenData.access_token);
    }
    if (!email) {
      email = `${profile.username}@users.noreply.github.com`;
    }
    let user = await getUserByGitHubId(profile.githubId);
    if (!user) {
      // Try to link to existing user by email or username
      const existing = (await getUserByEmail(email)) || (await getUserByUsername(profile.username));
      if (existing) {
        await linkGitHubId(existing.id, profile.githubId);
        user = existing;
      } else {
        const userCount = (await getAllUsers()).length;
        const role: UserRole = userCount === 0 ? 'admin' : 'advanced';
        user = await createGitHubUser(profile.githubId, email, profile.username, role);
      }
    }
    const payload: JwtPayload = {
      userId: user.id,
      email: user.email,
      role: canonicalizeRole(user.role),
      permissions: user.permissions || undefined,
      scope: 'user',
    };
    const token = signJwt(payload);
    issueAuthCookie(res, token);
    res.json({ token, user: { id: user.id, email: user.email, username: user.username, role: user.role } });
  } catch (error: any) {
    console.error('GitHub OAuth callback error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// Microsoft OAuth flow (Outlook / Office 365 / personal accounts).
// Reuses ONEDRIVE_CLIENT_ID / ONEDRIVE_CLIENT_SECRET — the Microsoft Entra
// app already registered for the OneDrive plugin. The login callback URL must
// be added to the same Entra app's "Redirect URIs" alongside the OneDrive one.
router.get('/auth/microsoft/status', (req, res) => {
  res.json({ enabled: isMicrosoftOAuthConfigured(), clientId: getMicrosoftClientId() });
});

router.get('/auth/microsoft/url', (req, res) => {
  const clientId = getMicrosoftClientId();
  if (!clientId) {
    return res.status(503).json({ error: 'Microsoft OAuth not configured' });
  }
  const redirectUri = (req.query.redirect_uri as string) || '';
  if (!redirectUri) {
    return res.status(400).json({ error: 'redirect_uri required' });
  }
  const state = generateUuid();
  const scope = 'openid profile email User.Read offline_access';
  const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?` +
    `client_id=${encodeURIComponent(clientId)}&response_type=code&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&` +
    `response_mode=query&prompt=select_account&state=${state}`;
  res.json({ url, state });
});

router.post('/auth/microsoft/callback', async (req, res) => {
  try {
    const { code, redirectUri } = req.body || {};
    if (!code || !redirectUri) {
      return res.status(400).json({ error: 'code and redirectUri required' });
    }
    const tokenData = await exchangeMicrosoftCodeForToken(code, redirectUri);
    const profile = await fetchMicrosoftProfile(tokenData.access_token);
    let user = await getUserByMicrosoftId(profile.microsoftId);
    if (!user) {
      const existing = (await getUserByEmail(profile.email)) || (await getUserByUsername(profile.username));
      if (existing) {
        await linkMicrosoftId(existing.id, profile.microsoftId);
        user = existing;
      } else {
        const userCount = (await getAllUsers()).length;
        const role: UserRole = userCount === 0 ? 'admin' : 'advanced';
        user = await createMicrosoftUser(profile.microsoftId, profile.email, profile.username, role);
      }
    }
    const payload: JwtPayload = {
      userId: user.id,
      email: user.email,
      role: canonicalizeRole(user.role),
      permissions: user.permissions || undefined,
      scope: 'user',
    };
    const token = signJwt(payload);
    issueAuthCookie(res, token);
    res.json({ token, user: { id: user.id, email: user.email, username: user.username, role: user.role } });
  } catch (error: any) {
    console.error('Microsoft OAuth callback error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

router.use(authenticateToken);

export interface AuthenticatedRequest extends Request {
  user?: User;
}

function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const auth = req.headers.authorization || '';
  let token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token && req.cookies && req.cookies[COOKIE_NAME]) {
    token = req.cookies[COOKIE_NAME];
  }
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = jwt.verify(token, getEnvOrDie('JWT_SECRET')) as JwtPayload;
    if (payload.scope !== 'user') {
      return res.status(401).json({ error: 'Invalid token scope' });
    }
    getUserById(payload.userId).then((user) => {
      if (!user) return res.status(401).json({ error: 'User not found' });
      req.user = user;
      next();
    }).catch((err) => {
      console.error('Auth lookup error:', err);
      res.status(500).json({ error: 'Authentication error' });
    });
  } catch (error: any) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

export { authenticateToken };
export default router;