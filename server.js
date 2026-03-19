// ==========================================
// LIMITGUARD SAAS - FIREBASE BACKEND
// ==========================================

const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'limitguard_super_secret_key_2024';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// FIREBASE INITIALIZATION
// ==========================================

// Try to initialize Firebase from environment variable
let db = null;

try {
    // Option 1: From JSON string in env var
    if (process.env.FIREBASE_CONFIG) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        db = admin.firestore();
        console.log('✅ Firebase initialized from environment');
    } 
    // Option 2: From local file (for development)
    else {
        try {
            const serviceAccount = require('./firebase-config.json');
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            db = admin.firestore();
            console.log('✅ Firebase initialized from local file');
        } catch (e) {
            console.log('⚠️ No Firebase config found, using in-memory storage');
        }
    }
} catch (error) {
    console.error('❌ Firebase initialization error:', error.message);
}

// ==========================================
// FALLBACK: IN-MEMORY STORAGE
// ==========================================

let memoryDB = {
    users: [],
    servers: {},
    pendingCommands: {}
};

// Super Admin (hardcoded for safety)
const SUPER_ADMIN = {
    id: 'admin_001',
    email: 'admin@limitguard.com',
    name: 'Super Admin',
    avatar: '👑',
    role: 'superadmin',
    password: 'admin123',
    createdAt: Date.now(),
    subscription: { plan: 'lifetime', active: true }
};

// ==========================================
// DATABASE HELPERS
// ==========================================

async function dbGet(collection, doc) {
    if (db) {
        const snap = await db.collection(collection).doc(doc).get();
        return snap.exists ? snap.data() : null;
    }
    return memoryDB[collection]?.[doc] || null;
}

async function dbSet(collection, doc, data) {
    if (db) {
        await db.collection(collection).doc(doc).set(data, { merge: true });
    } else {
        if (!memoryDB[collection]) memoryDB[collection] = {};
        memoryDB[collection][doc] = data;
    }
}

async function dbDelete(collection, doc) {
    if (db) {
        await db.collection(collection).doc(doc).delete();
    } else {
        delete memoryDB[collection]?.[doc];
    }
}

async function dbGetCollection(collection) {
    if (db) {
        const snap = await db.collection(collection).get();
        const items = [];
        snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
        return items;
    }
    return Object.entries(memoryDB[collection] || {}).map(([id, data]) => ({ id, ...data }));
}

async function dbQuery(collection, field, value) {
    if (db) {
        const snap = await db.collection(collection).where(field, '==', value).limit(1).get();
        if (snap.empty) return null;
        const doc = snap.docs[0];
        return { id: doc.id, ...doc.data() };
    }
    
    const items = memoryDB[collection] || {};
    for (const [id, data] of Object.entries(items)) {
        if (data[field] === value) return { id, ...data };
    }
    return null;
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function generateId() {
    return uuidv4();
}

function generateLicenseKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key = 'LG-';
    for (let i = 0; i < 4; i++) {
        if (i > 0) key += '-';
        for (let j = 0; j < 4; j++) {
            key += chars.charAt(Math.floor(Math.random() * chars.length));
        }
    }
    return key;
}

function generateApiKey() {
    return 'sk_' + uuidv4().replace(/-/g, '');
}

async function findUserByEmail(email) {
    if (email === SUPER_ADMIN.email) return SUPER_ADMIN;
    return dbQuery('users', 'email', email);
}

async function findUserById(id) {
    if (id === SUPER_ADMIN.id) return SUPER_ADMIN;
    return dbGet('users', id);
}

function isSubscriptionActive(user) {
    if (!user) return false;
    if (user.role === 'superadmin') return true;
    if (!user.subscription) return false;
    if (user.subscription.plan === 'lifetime') return true;
    if (!user.subscription.active) return false;
    if (user.subscription.expiresAt && Date.now() > user.subscription.expiresAt) return false;
    return true;
}

function createJWT(user) {
    return jwt.sign(
        { id: user.id, email: user.email, role: user.role, name: user.name },
        JWT_SECRET,
        { expiresIn: '7d' }
    );
}

function verifyJWT(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch { return null; }
}

// ==========================================
// MIDDLEWARE
// ==========================================

function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'No token' });
    }
    
    const decoded = verifyJWT(token);
    if (!decoded) {
        return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    
    req.user = decoded;
    next();
}

function superAdminMiddleware(req, res, next) {
    if (req.user.role !== 'superadmin') {
        return res.status(403).json({ success: false, message: 'Super admin only' });
    }
    next();
}

// ==========================================
// AUTH ROUTES
// ==========================================

app.post('/api/auth/register', async (req, res) => {
    const { email, password, name } = req.body;
    
    if (!email || !password || !name) {
        return res.status(400).json({ success: false, message: 'Missing fields' });
    }
    
    if (await findUserByEmail(email)) {
        return res.status(400).json({ success: false, message: 'Email exists' });
    }
    
    const user = {
        id: generateId(),
        email,
        password, // TODO: Hash in production!
        name,
        avatar: name.charAt(0).toUpperCase(),
        role: 'user',
        createdAt: Date.now(),
        subscription: { plan: 'free', active: true },
        servers: []
    };
    
    await dbSet('users', user.id, user);
    
    const token = createJWT(user);
    res.json({ success: true, token, user: { ...user, password: undefined } });
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    
    const user = await findUserByEmail(email);
    
    if (!user || user.password !== password) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    const token = createJWT(user);
    res.json({ success: true, token, user: { ...user, password: undefined } });
});

app.post('/api/auth/google', async (req, res) => {
    const { email, name, googleId, avatar } = req.body;
    
    let user = await findUserByEmail(email);
    
    if (!user) {
        user = {
            id: generateId(),
            email,
            name,
            avatar: avatar || name.charAt(0).toUpperCase(),
            googleId,
            role: 'user',
            createdAt: Date.now(),
            subscription: { plan: 'free', active: true },
            servers: []
        };
        await dbSet('users', user.id, user);
    }
    
    const token = createJWT(user);
    res.json({ success: true, token, user: { ...user, password: undefined } });
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
    const user = await findUserById(req.user.id);
    if (!user) return res.status(404).json({ success: false });
    res.json({ success: true, user: { ...user, password: undefined } });
});

// ==========================================
// SERVERS ROUTES
// ==========================================

app.get('/api/servers', authMiddleware, async (req, res) => {
    const user = await findUserById(req.user.id);
    if (!user) return res.status(404).json({ success: false });
    
    if (!isSubscriptionActive(user)) {
        return res.status(403).json({ success: false, expired: true, message: 'Subscription expired' });
    }
    
    const servers = [];
    for (const license of (user.servers || [])) {
        const server = await dbGet('servers', license);
        if (server) {
            servers.push({
                license: server.license,
                name: server.name,
                connected: server.connected,
                lastUpdate: server.lastUpdate,
                players: Object.keys(server.players || {}).length
            });
        }
    }
    
    res.json({ success: true, servers });
});

app.post('/api/servers', authMiddleware, async (req, res) => {
    const { name } = req.body;
    const user = await findUserById(req.user.id);
    
    if (!user) return res.status(404).json({ success: false });
    if (!isSubscriptionActive(user)) {
        return res.status(403).json({ success: false, expired: true });
    }
    
    const limits = { free: 1, basic: 3, pro: 10, lifetime: 999 };
    const limit = limits[user.subscription?.plan] || 1;
    
    if ((user.servers || []).length >= limit) {
        return res.status(400).json({ success: false, message: 'Limit reached' });
    }
    
    const license = generateLicenseKey();
    const apiKey = generateApiKey();
    
    const server = {
        license,
        apiKey,
        ownerId: user.id,
        name: name || 'My Server',
        admins: [],
        connected: false,
        lastUpdate: null,
        players: {},
        stats: {},
        events: [],
        pendingCommands: [],
        createdAt: Date.now()
    };
    
    await dbSet('servers', license, server);
    
    if (!user.servers) user.servers = [];
    user.servers.push(license);
    await dbSet('users', user.id, user);
    
    res.json({ success: true, server: { license, apiKey, name: server.name } });
});

app.get('/api/servers/:license', authMiddleware, async (req, res) => {
    const server = await dbGet('servers', req.params.license);
    if (!server) return res.status(404).json({ success: false });
    
    const user = await findUserById(req.user.id);
    const isOwner = server.ownerId === req.user.id;
    const isAdmin = server.admins?.some(a => a.id === req.user.id);
    const isSuper = req.user.role === 'superadmin';
    
    if (!isOwner && !isAdmin && !isSuper) {
        return res.status(403).json({ success: false });
    }
    
    if (!isSuper && !isSubscriptionActive(await findUserById(server.ownerId))) {
        return res.status(403).json({ success: false, expired: true });
    }
    
    if (server.lastUpdate && Date.now() - server.lastUpdate > 30000) {
        server.connected = false;
    }
    
    res.json({ success: true, server: { ...server, apiKey: isOwner ? server.apiKey : undefined } });
});

app.delete('/api/servers/:license', authMiddleware, async (req, res) => {
    const server = await dbGet('servers', req.params.license);
    if (!server) return res.status(404).json({ success: false });
    
    if (server.ownerId !== req.user.id && req.user.role !== 'superadmin') {
        return res.status(403).json({ success: false });
    }
    
    const owner = await findUserById(server.ownerId);
    if (owner && owner.servers) {
        owner.servers = owner.servers.filter(l => l !== req.params.license);
        await dbSet('users', owner.id, owner);
    }
    
    await dbDelete('servers', req.params.license);
    res.json({ success: true });
});

// ==========================================
// FIVEM CONNECTION
// ==========================================

app.post('/api/fivem/connect', async (req, res) => {
    const { license, apiKey } = req.body;
    const server = await dbGet('servers', license);
    
    if (!server) return res.status(404).json({ success: false, message: 'Invalid license' });
    if (server.apiKey !== apiKey) return res.status(401).json({ success: false });
    if (!isSubscriptionActive(await findUserById(server.ownerId))) {
        return res.status(403).json({ success: false, expired: true });
    }
    
    server.connected = true;
    server.lastUpdate = Date.now();
    server.events = server.events || [];
    server.events.unshift({ type: 'connect', time: Date.now() });
    
    await dbSet('servers', license, server);
    res.json({ success: true, serverName: server.name });
});

app.post('/api/fivem/update', async (req, res) => {
    const { license, apiKey, stats, players } = req.body;
    const server = await dbGet('servers', license);
    
    if (!server || server.apiKey !== apiKey) return res.status(401).json({ success: false });
    if (!isSubscriptionActive(await findUserById(server.ownerId))) {
        return res.status(403).json({ success: false, expired: true });
    }
    
    server.connected = true;
    server.lastUpdate = Date.now();
    if (stats) server.stats = { ...server.stats, ...stats };
    if (players) server.players = players;
    
    await dbSet('servers', license, server);
    res.json({ success: true });
});

app.post('/api/fivem/heartbeat', async (req, res) => {
    const { license, apiKey } = req.body;
    const server = await dbGet('servers', license);
    
    if (!server || server.apiKey !== apiKey) return res.status(401).json({ success: false });
    if (!isSubscriptionActive(await findUserById(server.ownerId))) {
        return res.status(403).json({ success: false, expired: true });
    }
    
    server.lastUpdate = Date.now();
    server.connected = true;
    await dbSet('servers', license, server);
    res.json({ success: true });
});

app.get('/api/fivem/commands/:license', async (req, res) => {
    const apiKey = req.headers['x-api-key'];
    const server = await dbGet('servers', req.params.license);
    
    if (!server || server.apiKey !== apiKey) return res.status(401).json({ success: false });
    
    if (!isSubscriptionActive(await findUserById(server.ownerId))) {
        return res.json({ success: false, expired: true, commands: [{ command: 'subscription_expired' }] });
    }
    
    const commands = server.pendingCommands || [];
    server.pendingCommands = [];
    await dbSet('servers', req.params.license, server);
    
    res.json({ success: true, commands });
});

// ==========================================
// PANEL COMMANDS
// ==========================================

app.post('/api/servers/:license/command', authMiddleware, async (req, res) => {
    const { license } = req.params;
    const { command, data } = req.body;
    
    const server = await dbGet('servers', license);
    if (!server) return res.status(404).json({ success: false });
    
    const user = await findUserById(req.user.id);
    const isOwner = server.ownerId === req.user.id;
    const isAdmin = server.admins?.some(a => a.id === req.user.id);
    const isSuper = req.user.role === 'superadmin';
    
    if (!isOwner && !isAdmin && !isSuper) return res.status(403).json({ success: false });
    if (!isSuper && !isSubscriptionActive(await findUserById(server.ownerId))) {
        return res.status(403).json({ success: false, expired: true });
    }
    
    server.pendingCommands = server.pendingCommands || [];
    server.pendingCommands.push({ command, data, timestamp: Date.now() });
    
    server.events = server.events || [];
    server.events.unshift({ type: command, data, time: Date.now() });
    
    await dbSet('servers', license, server);
    res.json({ success: true });
});

// ==========================================
// SUPER ADMIN
// ==========================================

app.get('/api/admin/users', authMiddleware, superAdminMiddleware, async (req, res) => {
    const users = await dbGetCollection('users');
    users.unshift({ ...SUPER_ADMIN, password: undefined });
    res.json({ success: true, users: users.map(u => ({ ...u, password: undefined })) });
});

app.get('/api/admin/servers', authMiddleware, superAdminMiddleware, async (req, res) => {
    const servers = await dbGetCollection('servers');
    res.json({ success: true, servers });
});

app.post('/api/admin/users/:userId/subscription', authMiddleware, superAdminMiddleware, async (req, res) => {
    const { plan, duration } = req.body;
    const user = await dbGet('users', req.params.userId);
    if (!user) return res.status(404).json({ success: false });
    
    user.subscription = {
        plan: plan || 'pro',
        expiresAt: duration ? Date.now() + duration * 86400000 : null,
        active: true,
        grantedBy: req.user.id
    };
    
    await dbSet('users', req.params.userId, user);
    res.json({ success: true });
});

app.get('/api/admin/stats', authMiddleware, superAdminMiddleware, async (req, res) => {
    const users = await dbGetCollection('users');
    const servers = await dbGetCollection('servers');
    
    res.json({
        success: true,
        stats: {
            totalUsers: users.length + 1,
            totalServers: servers.length,
            connected: servers.filter(s => s.connected).length
        }
    });
});

// ==========================================
// SPA
// ==========================================

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// START
// ==========================================

app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════╗
║     LimitGuard SaaS + Firebase           ║
║     Port: ${PORT}                           ║
║     Database: ${db ? 'Firestore' : 'Memory'}                    ║
╚═══════════════════════════════════════════╝
    `);
});
