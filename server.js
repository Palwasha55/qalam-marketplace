// Qalam backend — Express, with session-based auth, rate limiting, and input validation.
// Run with: node server.js  (after `npm install`)
// Data persists to ./data/db.json — a plain file, fine for early use, worth
// upgrading to a real database (SQLite/Postgres) once you have real traffic.

const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Change ADMIN_PASSWORD and SESSION_SECRET via environment variables before
// putting this online for real — see README "Setting your environment variables".
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-this-password';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-secret-too';

// ---------- tiny JSON "database" ----------
function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const initial = { users: [], jobs: [], applications: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}
function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// ---------- password hashing (scrypt, built into Node — no extra dependency, no native build step) ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

// ---------- validation helpers ----------
function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function isNonEmptyString(v, maxLen = 5000) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= maxLen;
}
function publicUser(u) {
  const { password, ...rest } = u;
  return rest;
}

// ---------- app setup ----------
const app = express();
app.set('trust proxy', 1); // needed on Render/most hosts so rate-limit and secure cookies see the real client IP/protocol
app.use(express.json());

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    // Render serves your site over https, so secure cookies work there.
    // If you ever test with plain http (not https) locally, they won't —
    // set FORCE_INSECURE_COOKIES=true locally only, never in production.
    secure: process.env.FORCE_INSECURE_COOKIES ? false : true,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

// ---------- rate limiters ----------
// Applied to the specific endpoints people could try to spam or brute-force.
const signupLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 10,
  message: { error: 'too many attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 15,
  message: { error: 'too many attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});
const adminLoginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: { error: 'too many attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

// ---------- auth middleware ----------
function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'you must be logged in' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'admin login required' });
  next();
}

// =====================================================================
// AUTH — signup, login, logout, me
// =====================================================================

app.post('/api/signup', signupLimiter, (req, res) => {
  const { name, email, password, role, skill, yearsExperience, bio } = req.body || {};

  if (!isNonEmptyString(name, 200)) return res.status(400).json({ error: 'name is required' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'please enter a valid email address' });
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }
  if (!['client', 'freelancer'].includes(role)) {
    return res.status(400).json({ error: 'role must be client or freelancer' });
  }
  if (role === 'freelancer') {
    if (skill !== undefined && skill !== null && !isNonEmptyString(String(skill), 200)) {
      return res.status(400).json({ error: 'invalid skill' });
    }
    if (bio !== undefined && bio !== null && String(bio).length > 3000) {
      return res.status(400).json({ error: 'bio is too long' });
    }
  }

  const db = loadDB();
  if (db.users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: 'an account with that email already exists' });
  }

  const user = {
    id: crypto.randomUUID(),
    name: name.trim(),
    email: email.trim(),
    role,
    password: hashPassword(password),
    skill: role === 'freelancer' ? (skill || null) : null,
    yearsExperience: role === 'freelancer' ? (yearsExperience || null) : null,
    bio: role === 'freelancer' ? (bio || null) : null,
    verified: false, // freelancers start hidden until an admin approves them
    createdAt: Date.now()
  };
  db.users.push(user);
  saveDB(db);

  req.session.userId = user.id;
  res.status(201).json({ user: publicUser(user) });
});

app.post('/api/login', loginLimiter, (req, res) => {
  const { email, password } = req.body || {};
  if (!isValidEmail(email) || typeof password !== 'string') {
    return res.status(400).json({ error: 'email and password are required' });
  }
  const db = loadDB();
  const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user || !verifyPassword(password, user.password)) {
    return res.status(401).json({ error: 'invalid email or password' });
  }
  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', requireLogin, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'not authenticated' });
  res.json({ user: publicUser(user) });
});

// =====================================================================
// PUBLIC BROWSE
// =====================================================================

app.get('/api/freelancers', (req, res) => {
  const db = loadDB();
  const list = db.users.filter(u => u.role === 'freelancer' && u.verified).map(publicUser);
  res.json({ freelancers: list });
});

app.get('/api/jobs', (req, res) => {
  const db = loadDB();
  res.json({ jobs: db.jobs.filter(j => j.status === 'open') });
});

// =====================================================================
// JOBS & APPLICATIONS
// =====================================================================

app.post('/api/jobs', requireLogin, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user || user.role !== 'client') return res.status(403).json({ error: 'only clients can post jobs' });

  const { title, category, description, budget } = req.body || {};
  if (!isNonEmptyString(title, 200)) return res.status(400).json({ error: 'title is required' });
  if (!isNonEmptyString(description, 5000)) return res.status(400).json({ error: 'description is required' });
  if (budget !== undefined && budget !== null && String(budget).length > 100) {
    return res.status(400).json({ error: 'budget field is too long' });
  }

  const job = {
    id: crypto.randomUUID(),
    clientId: user.id,
    title: title.trim(),
    category: isNonEmptyString(category, 100) ? category.trim() : 'General',
    description: description.trim(),
    budget: budget || null,
    status: 'open',
    createdAt: Date.now()
  };
  db.jobs.push(job);
  saveDB(db);
  res.status(201).json({ job });
});

app.get('/api/jobs/mine', requireLogin, (req, res) => {
  const db = loadDB();
  const mine = db.jobs.filter(j => j.clientId === req.session.userId);
  res.json({ jobs: mine });
});

app.post('/api/jobs/:id/apply', requireLogin, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user || user.role !== 'freelancer') return res.status(403).json({ error: 'only freelancers can apply to jobs' });
  if (!user.verified) return res.status(403).json({ error: 'your profile is still pending verification' });

  const job = db.jobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });

  const { message } = req.body || {};
  if (message !== undefined && String(message).length > 2000) {
    return res.status(400).json({ error: 'message is too long' });
  }
  if (db.applications.find(a => a.jobId === job.id && a.freelancerId === user.id)) {
    return res.status(409).json({ error: 'you already applied to this job' });
  }

  const application = {
    id: crypto.randomUUID(),
    jobId: job.id,
    freelancerId: user.id,
    message: message || '',
    status: 'pending',
    createdAt: Date.now()
  };
  db.applications.push(application);
  saveDB(db);
  res.status(201).json({ application });
});

app.get('/api/jobs/:id/applications', requireLogin, (req, res) => {
  const db = loadDB();
  const job = db.jobs.find(j => j.id === req.params.id);
  if (!job || job.clientId !== req.session.userId) return res.status(401).json({ error: 'not authorized' });

  const apps = db.applications
    .filter(a => a.jobId === job.id)
    .map(a => ({ ...a, freelancer: publicUser(db.users.find(u => u.id === a.freelancerId)) }));
  res.json({ applications: apps });
});

// =====================================================================
// ADMIN — password-gated, session-based
// =====================================================================

app.post('/api/admin/login', adminLoginLimiter, (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== 'string' || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'incorrect admin password' });
  }
  req.session.isAdmin = true;
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.isAdmin = false;
  res.json({ ok: true });
});

app.get('/api/admin/status', (req, res) => {
  res.json({ isAdmin: !!req.session.isAdmin });
});

app.get('/api/admin/pending', requireAdmin, (req, res) => {
  const db = loadDB();
  res.json({ pending: db.users.filter(u => u.role === 'freelancer' && !u.verified).map(publicUser) });
});

app.get('/api/admin/verified', requireAdmin, (req, res) => {
  const db = loadDB();
  res.json({ verified: db.users.filter(u => u.role === 'freelancer' && u.verified).map(publicUser) });
});

app.post('/api/admin/verify/:id', requireAdmin, (req, res) => {
  const db = loadDB();
  const u = db.users.find(x => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'user not found' });
  u.verified = true;
  saveDB(db);
  res.json({ user: publicUser(u) });
});

app.post('/api/admin/unverify/:id', requireAdmin, (req, res) => {
  const db = loadDB();
  const u = db.users.find(x => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'user not found' });
  u.verified = false;
  saveDB(db);
  res.json({ user: publicUser(u) });
});

// =====================================================================
// STATIC FRONTEND + fallback
// =====================================================================

app.use(express.static(PUBLIC_DIR));

app.use((req, res) => {
  res.status(404).json({ error: 'not found' });
});

// generic error handler — so a thrown error never leaks a stack trace to the client
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'server error' });
});

app.listen(PORT, () => {
  console.log(`Qalam server running on port ${PORT}`);
});
