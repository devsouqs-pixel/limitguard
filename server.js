// ==========================================
// LIMITGUARD SAAS - SAFE VERSION
// ==========================================

const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'limitguard_secret_2024';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

console.log('=================================');
console.log('LimitGuard Starting...');
console.log('Node:', process.version);
console.log('PORT:', PORT);
console.log('=================================');

// ==========================================
// FIREBASE - SAFE INITIALIZATION
// ==========================================

let db = null;
let admin = null;

async function initFirebase() {
    try {
        // Check if Firebase config exists
        if (!process.env.FIREBASE_CONFIG) {
            console.log('⚠️ No FIREBASE_CONFIG found, using memory storage');
            return null;
        }
        
        // Import firebase-admin only if needed
        admin = require('firebase-admin');
        
        // Parse config safely
        let configStr = process.env.FIREBASE_CONFIG;
        
        // Fix newlines in private key (IMPORTANT!)
        configStr = configStr.replace(/\\n/g, '\n');
        
        const serviceAccount = JSON.parse(configStr);
        
        // Initialize
        if (admin.apps.length === 0) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
        }
        
        db = admin.firestore();
        console.log('✅ Firebase connected!');
        return db;
        
    } catch (error) {
        console.error('❌ Firebase error:', error.message);
        console.log('⚠️ Falling back to memory storage');
        return null;
    }
}

// ==========================================
// MEMORY STORAGE (Fallback)
// ==========================================

const memoryDB = {
    users: {},
    servers: {}
};

// Super Admin
const SUPER_ADMIN = {
    id: 'admin_001',
    email: 'admin@limitguard.com',
    password: 'admin123',
    name: 'Super Admin',
    avatar: '👑',
    role: 'superadmin',
    subscription: { plan: 'lifetime', active: true },
    servers: [],
    createdAt: Date.now()
};

memoryDB.users[SUPER_ADMIN.id] = SUPER_ADMIN;

// ==========================================
// DATABASE HELPERS
// ==========================================

async function dbGet(collection, id) {
    if (db) {
        try {
            const doc = await db.collection(collection).doc(id).get();
            return doc.exists ? { id: doc.id, ...doc.data() } : null;
        } catch (e) {
            console.error('Firestore error:', e.message);
            return null;
        }
    }
    return memoryDB[collection]?.[id] || null;
}

async function dbSet(collection, id, data) {
    if (db) {
        try {
            await db.collection(collection).doc(id).set(data, { merge: true });
            return true;
        } catch (e) {
            console.error('Firestore error:', e.message);
            return false;
        }
    }
    if (!memoryDB[collection]) memoryDB[collection] = {};
    memoryDB[collection][id] = data;
    return true;
}

async function dbDelete(collection, id) {
    if (db) {
        try {
            await db.collection(collection).doc(id).delete();
        } catch (e) {}
    }
    delete memoryDB[collection]?.[id];
}

async function dbQuery(collection, field, value) {
    if (db) {
        try {
            const snap = await db.collection(collection).where(field, '==', value).limit(1).get();
            if (snap.empty) return null;
            const doc = snap.docs[0];
            return { id: doc.id, ...doc.data() };
        } catch (e) {
            return null;
        }
    }
    for (const item of Object.values(memoryDB[collection] || {})) {
        if (item[field] === value) return item;
    }
    return null;
}

async function dbGetAll(collection) {
    if (db) {
        try {
            const snap = await db.collection(collection).get();
            const items = [];
            snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
            return items;
        } catch (e) {
            return [];
        }
    }
    return Object.values(memoryDB[collection] || {});
}

// ==========================================
// HELPERS
// ==========================================

const generateId = () => uuidv4();

function generateLicenseKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key = 'LG-';
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 4; j++) key += chars[Math.floor(Math.random() * chars.length)];
        if (i < 2) key += '-';
    }
    return key;
}

const generateApiKey = () => 'sk_' + uuidv4().replace(/-/g, '');
const createToken = (user) => jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
const verifyToken = (token) => { try { return jwt.verify(token, JWT_SECRET); } catch { return null; } };

const findUserByEmail = async (email) => 
    email === SUPER_ADMIN.email ? SUPER_ADMIN : dbQuery('users', 'email', email);

const findUserById = async (id) => 
    id === SUPER_ADMIN.id ? SUPER_ADMIN : dbGet('users', id);

function isActive(user) {
    if (!user) return false;
    if (user.role === 'superadmin') return true;
    if (!user.subscription?.active) return false;
    if (user.subscription.plan === 'lifetime') return true;
    if (user.subscription.expiresAt && Date.now() > user.subscription.expiresAt) return false;
    return true;
}

// Middleware
const auth = (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, message: 'No token' });
    const user = verifyToken(token);
    if (!user) return res.status(401).json({ success: false, message: 'Invalid' });
    req.user = user;
    next();
};

const superAdmin = (req, res, next) => {
    if (req.user.role !== 'superadmin') return res.status(403).json({ success: false });
    next();
};

// ==========================================
// ROUTES
// ==========================================

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', database: db ? 'firebase' : 'memory' });
});

// Auth
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await findUserByEmail(email);
    if (!user || user.password !== password) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    res.json({ success: true, token: createToken(user), user: { ...user, password: undefined } });
});

app.post('/api/auth/register', async (req, res) => {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: 'Missing fields' });
    if (await findUserByEmail(email)) return res.status(400).json({ success: false, message: 'Exists' });
    
    const user = {
        id: generateId(),
        email, password, name,
        avatar: name?.[0]?.toUpperCase() || '?',
        role: 'user',
        subscription: { plan: 'free', active: true },
        servers: [],
        createdAt: Date.now()
    };
    
    await dbSet('users', user.id, user);
    res.json({ success: true, token: createToken(user), user: { ...user, password: undefined } });
});

app.post('/api/auth/google', async (req, res) => {
    const { email, name } = req.body;
    let user = await findUserByEmail(email);
    
    if (!user) {
        user = {
            id: generateId(),
            email, name,
            avatar: name?.[0]?.toUpperCase() || '?',
            role: 'user',
            subscription: { plan: 'free', active: true },
            servers: [],
            createdAt: Date.now()
        };
        await dbSet('users', user.id, user);
    }
    
    res.json({ success: true, token: createToken(user), user: { ...user, password: undefined } });
});

app.get('/api/auth/me', auth, async (req, res) => {
    const user = await findUserById(req.user.id);
    res.json({ success: true, user: { ...user, password: undefined } });
});

// Servers
app.get('/api/servers', auth, async (req, res) => {
    const user = await findUserById(req.user.id);
    if (!user) return res.status(404).json({ success: false });
    if (!isActive(user)) return res.status(403).json({ success: false, expired: true });
    
    const servers = [];
    for (const lic of (user.servers || [])) {
        const s = await dbGet('servers', lic);
        if (s) servers.push({ license: s.license, name: s.name, connected: s.connected });
    }
    res.json({ success: true, servers });
});

app.post('/api/servers', auth, async (req, res) => {
    const user = await findUserById(req.user.id);
    if (!isActive(user)) return res.status(403).json({ success: false, expired: true });
    
    const limits = { free: 1, basic: 3, pro: 10, lifetime: 999 };
    if ((user.servers?.length || 0) >= (limits[user.subscription?.plan] || 1)) {
        return res.status(400).json({ success: false, message: 'Limit reached' });
    }
    
    const license = generateLicenseKey();
    const apiKey = generateApiKey();
    
    const server = {
        license, apiKey,
        ownerId: user.id,
        name: req.body.name || 'My Server',
        connected: false,
        lastUpdate: null,
        players: {},
        stats: {},
        pendingCommands: [],
        createdAt: Date.now()
    };
    
    await dbSet('servers', license, server);
    if (!user.servers) user.servers = [];
    user.servers.push(license);
    await dbSet('users', user.id, user);
    
    res.json({ success: true, server: { license, apiKey, name: server.name } });
});

app.get('/api/servers/:license', auth, async (req, res) => {
    const server = await dbGet('servers', req.params.license);
    if (!server) return res.status(404).json({ success: false });
    
    const user = await findUserById(req.user.id);
    const isOwner = server.ownerId === req.user.id;
    const isSuper = req.user.role === 'superadmin';
    
    if (!isOwner && !isSuper) return res.status(403).json({ success: false });
    if (!isSuper && !isActive(await findUserById(server.ownerId))) {
        return res.status(403).json({ success: false, expired: true });
    }
    
    res.json({ success: true, server: { ...server, apiKey: isOwner ? server.apiKey : undefined } });
});

app.delete('/api/servers/:license', auth, async (req, res) => {
    const server = await dbGet('servers', req.params.license);
    if (!server) return res.status(404).json({ success: false });
    if (server.ownerId !== req.user.id && req.user.role !== 'superadmin') {
        return res.status(403).json({ success: false });
    }
    
    const owner = await findUserById(server.ownerId);
    if (owner?.servers) {
        owner.servers = owner.servers.filter(l => l !== req.params.license);
        await dbSet('users', owner.id, owner);
    }
    
    await dbDelete('servers', req.params.license);
    res.json({ success: true });
});

// FiveM
app.post('/api/fivem/connect', async (req, res) => {
    const { license, apiKey } = req.body;
    const server = await dbGet('servers', license);
    
    if (!server || server.apiKey !== apiKey) {
        return res.status(401).json({ success: false, message: 'Invalid' });
    }
    
    if (!isActive(await findUserById(server.ownerId))) {
        return res.status(403).json({ success: false, expired: true });
    }
    
    server.connected = true;
    server.lastUpdate = Date.now();
    await dbSet('servers', license, server);
    res.json({ success: true });
});

app.post('/api/fivem/update', async (req, res) => {
    const { license, apiKey, stats, players } = req.body;
    const server = await dbGet('servers', license);
    
    if (!server || server.apiKey !== apiKey) return res.status(401).json({ success: false });
    if (!isActive(await findUserById(server.ownerId))) {
        return res.status(403).json({ success: false, expired: true });
    }
    
    server.connected = true;
    server.lastUpdate = Date.now();
    if (stats) server.stats = { ...server.stats, ...stats };
    if (players) server.players = players;
    await dbSet('servers', license, server);
    res.json({ success: true });
});

app.get('/api/fivem/commands/:license', async (req, res) => {
    const apiKey = req.headers['x-api-key'];
    const server = await dbGet('servers', req.params.license);
    
    if (!server || server.apiKey !== apiKey) return res.status(401).json({ success: false });
    if (!isActive(await findUserById(server.ownerId))) {
        return res.json({ success: false, expired: true, commands: [{ command: 'expired' }] });
    }
    
    const cmds = server.pendingCommands || [];
    server.pendingCommands = [];
    await dbSet('servers', req.params.license, server);
    res.json({ success: true, commands: cmds });
});

// Commands
app.post('/api/servers/:license/command', auth, async (req, res) => {
    const server = await dbGet('servers', req.params.license);
    if (!server) return res.status(404).json({ success: false });
    
    const isOwner = server.ownerId === req.user.id;
    const isSuper = req.user.role === 'superadmin';
    if (!isOwner && !isSuper) return res.status(403).json({ success: false });
    
    server.pendingCommands = server.pendingCommands || [];
    server.pendingCommands.push({ ...req.body, timestamp: Date.now() });
    await dbSet('servers', req.params.license, server);
    res.json({ success: true });
});

// Super Admin
app.get('/api/admin/users', auth, superAdmin, async (req, res) => {
    const users = await dbGetAll('users');
    users.push({ ...SUPER_ADMIN, password: undefined });
    res.json({ success: true, users: users.map(u => ({ ...u, password: undefined })) });
});

app.get('/api/admin/servers', auth, superAdmin, async (req, res) => {
    res.json({ success: true, servers: await dbGetAll('servers') });
});

app.post('/api/admin/users/:id/subscription', auth, superAdmin, async (req, res) => {
    const { plan, duration } = req.body;
    const user = await dbGet('users', req.params.id);
    if (!user) return res.status(404).json({ success: false });
    
    user.subscription = {
        plan: plan || 'pro',
        active: true,
        expiresAt: duration ? Date.now() + duration * 86400000 : null
    };
    
    await dbSet('users', req.params.id, user);
    res.json({ success: true });
});

// SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// START
// ==========================================

async function start() {
    // Try Firebase
    await initFirebase();
    
    app.listen(PORT, () => {
        console.log(`
╔═════════════════════════════════════════╗
║  LimitGuard Running on port ${PORT}        ║
║  Database: ${db ? 'Firebase' : 'Memory'}             ║
╚═════════════════════════════════════════╝
        `);
    });
}

start().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
