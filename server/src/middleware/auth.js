import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const router = express.Router();

// In-memory users store (in production, use a database)
const users = new Map();
let usersInitialized = false;

// Initialize default admin user (lazy, called on first auth request)
const ensureUsersInitialized = async () => {
  if (usersInitialized) return;
  usersInitialized = true;
  
  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD || 'swarm2026';
  const hash = await bcrypt.hash(adminPassword, 10);
  users.set(adminUsername, {
    username: adminUsername,
    password: hash,
    role: 'admin'
  });
  console.log(`✅ Admin user initialized: ${adminUsername}`);
};

// Helper to get JWT secret at runtime
const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  return secret;
};

// Login
router.post('/login', async (req, res) => {
  try {
    await ensureUsersInitialized();
    
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const user = users.get(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { username: user.username, role: user.role },
      getJwtSecret(),
      { expiresIn: '24h' }
    );

    res.json({ token, username: user.username, role: user.role });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify token
router.get('/verify', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token provided' });

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    res.json({ valid: true, user: decoded });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Auth middleware
export function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Access denied' });

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

export { router as authRouter };
