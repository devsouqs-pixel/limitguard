// ==========================================
// LIMITGUARD SAAS - FULL BACKEND
// ==========================================

const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'limitguard_super_secret_key_2024';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// DATA STORE (In production, use real database)
// ==========================================

let DB = {
    users: [],
    servers: {},
    subscriptions: [],
    pendingPayments: []
};

// Initialize Super Admin
const SUPER_ADMIN = {
    id: 'admin_001',
    email: 'admin@limitguard.com',
    name: 'Super Admin',
    avatar: '👑',
    role: 'superadmin',
    password: 'admin123', // In production, use hashed passwords
    createdAt: Date.now(),
    subscription: {
        plan: 'lifetime',
        expiresAt: null,
        active: true
    }
};

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

function findUserByEmail(email) {
    return DB.users.find(u => u.email === email) || 
           (email === SUPER_ADMIN.email ? SUPER_ADMIN : null);
}

function findUserById(id) {
    return DB.users.find(u => u.id === id) || 
           (id === SUPER_ADMIN.id ? SUPER_ADMIN : null);
}

function findServerByLicense(license) {
    return DB.servers[license];
}

function isSubscriptionActive(userId) {
    const user = findUserById(userId);
    if (!user) return false;
    
    // Super admin always active
    if (user.role === 'superadmin') return true;
    
    if (!user.subscription) return false;
    if (!user.subscription.active) return false;
    if (user.subscription.expiresAt && Date.now() > user.subscription.expiresAt) return false;
    
    return true;
}

function createJWT(user) {
    return jwt.sign(
        { 
            id: user.id, 
            email: user.email, 
            role: user.role,
            name: user.name
        },
        JWT_SECRET,
        { expiresIn: '7d' }
    );
}

function verifyJWT(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (e) {
        return null;
    }
}

// Auth Middleware
function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    const decoded = verifyJWT(token);
    if (!decoded) {
        return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    
    req.user = decoded;
    next();
}

// Super Admin Middleware
function superAdminMiddleware(req, res, next) {
    if (req.user.role !== 'superadmin') {
        return res.status(403).json({ success: false, message: 'Super admin only' });
    }
    next();
}

// ==========================================
// AUTH ROUTES
// ==========================================

// Register
app.post('/api/auth/register', (req, res) => {
    const { email, password, name } = req.body;
    
    if (!email || !password || !name) {
        return res.status(400).json({ success: false, message: 'Missing fields' });
    }
    
    if (findUserByEmail(email)) {
        return res.status(400).json({ success: false, message: 'Email already exists' });
    }
    
    const user = {
        id: generateId(),
        email,
        password, // Hash in production!
        name,
        avatar: name.charAt(0).toUpperCase(),
        role: 'user',
        createdAt: Date.now(),
        subscription: {
            plan: 'free',
            expiresAt: null,
            active: true
        },
        servers: []
    };
    
    DB.users.push(user);
    
    const token = createJWT(user);
    
    res.json({
        success: true,
        token,
        user: { ...user, password: undefined }
    });
});

// Login
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    
    const user = findUserByEmail(email);
    
    if (!user || user.password !== password) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    const token = createJWT(user);
    
    res.json({
        success: true,
        token,
        user: { ...user, password: undefined }
    });
});

// Google Login (Simulated - In production, verify Google token)
app.post('/api/auth/google', (req, res) => {
    const { email, name, googleId, avatar } = req.body;
    
    let user = findUserByEmail(email);
    
    if (!user) {
        user = {
            id: generateId(),
            email,
            name,
            avatar: avatar || name.charAt(0).toUpperCase(),
            googleId,
            role: 'user',
            createdAt: Date.now(),
            subscription: {
                plan: 'free',
                expiresAt: null,
                active: true
            },
            servers: []
        };
        DB.users.push(user);
    }
    
    const token = createJWT(user);
    
    res.json({
        success: true,
        token,
        user: { ...user, password: undefined }
    });
});

// Get Current User
app.get('/api/auth/me', authMiddleware, (req, res) => {
    const user = findUserById(req.user.id);
    
    if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    res.json({ success: true, user: { ...user, password: undefined } });
});

// Logout
app.post('/api/auth/logout', (req, res) => {
    res.json({ success: true });
});

// ==========================================
// SERVER ROUTES (User's Servers)
// ==========================================

// Get User's Servers
app.get('/api/servers', authMiddleware, (req, res) => {
    const user = findUserById(req.user.id);
    
    if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Check subscription
    if (!isSubscriptionActive(user.id)) {
        return res.status(403).json({ 
            success: false, 
            message: 'Subscription expired',
            expired: true
        });
    }
    
    const servers = (user.servers || []).map(license => {
        const server = DB.servers[license];
        if (!server) return null;
        
        return {
            license: server.license,
            name: server.name,
            connected: server.connected,
            lastUpdate: server.lastUpdate,
            players: Object.keys(server.players || {}).length
        };
    }).filter(Boolean);
    
    res.json({ success: true, servers });
});

// Create New Server
app.post('/api/servers', authMiddleware, (req, res) => {
    const { name } = req.body;
    const user = findUserById(req.user.id);
    
    if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Check subscription
    if (!isSubscriptionActive(user.id)) {
        return res.status(403).json({ 
            success: false, 
            message: 'Subscription expired',
            expired: true
        });
    }
    
    // Check server limit based on plan
    const limits = {
        free: 1,
        basic: 3,
        pro: 10,
        lifetime: 999
    };
    
    const limit = limits[user.subscription?.plan] || 1;
    const currentCount = (user.servers || []).length;
    
    if (currentCount >= limit) {
        return res.status(400).json({ 
            success: false, 
            message: `Server limit reached (${limit}). Upgrade your plan.` 
        });
    }
    
    const license = generateLicenseKey();
    const apiKey = generateApiKey();
    
    DB.servers[license] = {
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
        createdAt: Date.now()
    };
    
    if (!user.servers) user.servers = [];
    user.servers.push(license);
    
    res.json({
        success: true,
        server: {
            license,
            apiKey,
            name: name || 'My Server'
        }
    });
});

// Get Server Details
app.get('/api/servers/:license', authMiddleware, (req, res) => {
    const { license } = req.params;
    const server = DB.servers[license];
    
    if (!server) {
        return res.status(404).json({ success: false, message: 'Server not found' });
    }
    
    // Check ownership
    const user = findUserById(req.user.id);
    const isOwner = server.ownerId === req.user.id;
    const isAdmin = server.admins?.some(a => a.id === req.user.id);
    const isSuperAdmin = req.user.role === 'superadmin';
    
    if (!isOwner && !isAdmin && !isSuperAdmin) {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }
    
    // Check subscription (except for super admin)
    if (!isSuperAdmin && !isSubscriptionActive(server.ownerId)) {
        return res.status(403).json({ 
            success: false, 
            message: 'Subscription expired',
            expired: true
        });
    }
    
    // Check connection timeout
    if (server.lastUpdate && (Date.now() - server.lastUpdate > 30000)) {
        server.connected = false;
    }
    
    res.json({ 
        success: true, 
        server: {
            ...server,
            apiKey: isOwner ? server.apiKey : undefined
        }
    });
});

// Update Server Settings
app.put('/api/servers/:license', authMiddleware, (req, res) => {
    const { license } = req.params;
    const { name, admins } = req.body;
    const server = DB.servers[license];
    
    if (!server) {
        return res.status(404).json({ success: false, message: 'Server not found' });
    }
    
    if (server.ownerId !== req.user.id && req.user.role !== 'superadmin') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }
    
    if (name) server.name = name;
    if (admins) server.admins = admins;
    
    res.json({ success: true });
});

// Delete Server
app.delete('/api/servers/:license', authMiddleware, (req, res) => {
    const { license } = req.params;
    const server = DB.servers[license];
    
    if (!server) {
        return res.status(404).json({ success: false, message: 'Server not found' });
    }
    
    if (server.ownerId !== req.user.id && req.user.role !== 'superadmin') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }
    
    // Remove from owner's list
    const owner = findUserById(server.ownerId);
    if (owner && owner.servers) {
        owner.servers = owner.servers.filter(l => l !== license);
    }
    
    delete DB.servers[license];
    
    res.json({ success: true });
});

// Regenerate API Key
app.post('/api/servers/:license/regenerate', authMiddleware, (req, res) => {
    const { license } = req.params;
    const server = DB.servers[license];
    
    if (!server) {
        return res.status(404).json({ success: false, message: 'Server not found' });
    }
    
    if (server.ownerId !== req.user.id && req.user.role !== 'superadmin') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }
    
    server.apiKey = generateApiKey();
    
    res.json({ success: true, apiKey: server.apiKey });
});

// ==========================================
// FIVEM SERVER CONNECTION
// ==========================================

// Server Connect (From FiveM)
app.post('/api/fivem/connect', (req, res) => {
    const { license, apiKey } = req.body;
    
    const server = DB.servers[license];
    
    if (!server) {
        return res.status(404).json({ 
            success: false, 
            message: 'Invalid license key' 
        });
    }
    
    if (server.apiKey !== apiKey) {
        return res.status(401).json({ 
            success: false, 
            message: 'Invalid API key' 
        });
    }
    
    // Check subscription
    if (!isSubscriptionActive(server.ownerId)) {
        return res.status(403).json({ 
            success: false, 
            message: 'Subscription expired',
            expired: true
        });
    }
    
    server.connected = true;
    server.lastUpdate = Date.now();
    
    // Add event
    if (!server.events) server.events = [];
    server.events.unshift({
        type: 'connect',
        time: Date.now()
    });
    
    res.json({ 
        success: true,
        serverName: server.name
    });
});

// Server Update (From FiveM)
app.post('/api/fivem/update', (req, res) => {
    const { license, apiKey, stats, players } = req.body;
    
    const server = DB.servers[license];
    
    if (!server || server.apiKey !== apiKey) {
        return res.status(401).json({ success: false });
    }
    
    // Check subscription
    if (!isSubscriptionActive(server.ownerId)) {
        return res.status(403).json({ 
            success: false, 
            message: 'Subscription expired',
            expired: true
        });
    }
    
    server.connected = true;
    server.lastUpdate = Date.now();
    if (stats) server.stats = { ...server.stats, ...stats };
    if (players) server.players = players;
    
    res.json({ success: true });
});

// Heartbeat
app.post('/api/fivem/heartbeat', (req, res) => {
    const { license, apiKey } = req.body;
    
    const server = DB.servers[license];
    
    if (!server || server.apiKey !== apiKey) {
        return res.status(401).json({ success: false });
    }
    
    // Check subscription
    if (!isSubscriptionActive(server.ownerId)) {
        return res.status(403).json({ 
            success: false, 
            expired: true 
        });
    }
    
    server.lastUpdate = Date.now();
    server.connected = true;
    
    res.json({ success: true });
});

// Commands (From FiveM polling)
app.get('/api/fivem/commands/:license', (req, res) => {
    const { license } = req.params;
    const apiKey = req.headers['x-api-key'];
    
    const server = DB.servers[license];
    
    if (!server || server.apiKey !== apiKey) {
        return res.status(401).json({ success: false });
    }
    
    // Check subscription
    if (!isSubscriptionActive(server.ownerId)) {
        return res.json({ 
            success: false, 
            expired: true,
            commands: [{ command: 'subscription_expired' }]
        });
    }
    
    res.json({ 
        success: true, 
        commands: server.pendingCommands || [] 
    });
    
    server.pendingCommands = [];
});

// Send Command (From Panel)
app.post('/api/servers/:license/command', authMiddleware, (req, res) => {
    const { license } = req.params;
    const { command, data } = req.body;
    
    const server = DB.servers[license];
    
    if (!server) {
        return res.status(404).json({ success: false });
    }
    
    // Check access
    const isOwner = server.ownerId === req.user.id;
    const isAdmin = server.admins?.some(a => a.id === req.user.id);
    const isSuperAdmin = req.user.role === 'superadmin';
    
    if (!isOwner && !isAdmin && !isSuperAdmin) {
        return res.status(403).json({ success: false });
    }
    
    // Check subscription
    if (!isSuperAdmin && !isSubscriptionActive(server.ownerId)) {
        return res.status(403).json({ 
            success: false, 
            message: 'Subscription expired' 
        });
    }
    
    if (!server.pendingCommands) server.pendingCommands = [];
    
    server.pendingCommands.push({
        command,
        data,
        timestamp: Date.now()
    });
    
    // Add event
    if (!server.events) server.events = [];
    server.events.unshift({
        type: command,
        data,
        time: Date.now()
    });
    
    res.json({ success: true });
});

// ==========================================
// SERVER ADMINS
// ==========================================

// Get Server Admins
app.get('/api/servers/:license/admins', authMiddleware, (req, res) => {
    const { license } = req.params;
    const server = DB.servers[license];
    
    if (!server) {
        return res.status(404).json({ success: false });
    }
    
    if (server.ownerId !== req.user.id && req.user.role !== 'superadmin') {
        return res.status(403).json({ success: false });
    }
    
    res.json({ success: true, admins: server.admins || [] });
});

// Add Server Admin
app.post('/api/servers/:license/admins', authMiddleware, (req, res) => {
    const { license } = req.params;
    const { email, role } = req.body;
    const server = DB.servers[license];
    
    if (!server) {
        return res.status(404).json({ success: false });
    }
    
    if (server.ownerId !== req.user.id && req.user.role !== 'superadmin') {
        return res.status(403).json({ success: false });
    }
    
    const targetUser = findUserByEmail(email);
    
    if (!targetUser) {
        return res.status(404).json({ 
            success: false, 
            message: 'User not found. They need to register first.' 
        });
    }
    
    if (!server.admins) server.admins = [];
    
    if (server.admins.some(a => a.id === targetUser.id)) {
        return res.status(400).json({ 
            success: false, 
            message: 'User is already an admin' 
        });
    }
    
    server.admins.push({
        id: targetUser.id,
        email: targetUser.email,
        name: targetUser.name,
        role: role || 'moderator',
        addedAt: Date.now()
    });
    
    res.json({ success: true });
});

// Remove Server Admin
app.delete('/api/servers/:license/admins/:adminId', authMiddleware, (req, res) => {
    const { license, adminId } = req.params;
    const server = DB.servers[license];
    
    if (!server) {
        return res.status(404).json({ success: false });
    }
    
    if (server.ownerId !== req.user.id && req.user.role !== 'superadmin') {
        return res.status(403).json({ success: false });
    }
    
    server.admins = (server.admins || []).filter(a => a.id !== adminId);
    
    res.json({ success: true });
});

// ==========================================
// SUPER ADMIN ROUTES
// ==========================================

// Get All Users
app.get('/api/admin/users', authMiddleware, superAdminMiddleware, (req, res) => {
    const users = DB.users.map(u => ({ ...u, password: undefined }));
    users.unshift({ ...SUPER_ADMIN, password: undefined });
    
    res.json({ success: true, users });
});

// Get All Servers
app.get('/api/admin/servers', authMiddleware, superAdminMiddleware, (req, res) => {
    const servers = Object.values(DB.servers);
    res.json({ success: true, servers });
});

// Update User
app.put('/api/admin/users/:userId', authMiddleware, superAdminMiddleware, (req, res) => {
    const { userId } = req.params;
    const updates = req.body;
    
    // Prevent modifying super admin
    if (userId === SUPER_ADMIN.id) {
        return res.status(403).json({ success: false, message: 'Cannot modify super admin' });
    }
    
    const index = DB.users.findIndex(u => u.id === userId);
    
    if (index === -1) {
        return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Allowed updates
    if (updates.subscription) {
        DB.users[index].subscription = {
            ...DB.users[index].subscription,
            ...updates.subscription
        };
    }
    
    if (updates.role) {
        DB.users[index].role = updates.role;
    }
    
    if (updates.banned !== undefined) {
        DB.users[index].banned = updates.banned;
    }
    
    res.json({ success: true, user: { ...DB.users[index], password: undefined } });
});

// Give Subscription
app.post('/api/admin/users/:userId/subscription', authMiddleware, superAdminMiddleware, (req, res) => {
    const { userId } = req.params;
    const { plan, duration } = req.body; // duration in days
    
    const index = DB.users.findIndex(u => u.id === userId);
    
    if (index === -1) {
        return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    const expiresAt = duration ? Date.now() + (duration * 24 * 60 * 60 * 1000) : null;
    
    DB.users[index].subscription = {
        plan: plan || 'pro',
        expiresAt,
        active: true,
        grantedBy: req.user.id,
        grantedAt: Date.now()
    };
    
    res.json({ success: true });
});

// Platform Stats
app.get('/api/admin/stats', authMiddleware, superAdminMiddleware, (req, res) => {
    const totalUsers = DB.users.length + 1; // +1 for super admin
    const totalServers = Object.keys(DB.servers).length;
    const activeSubscriptions = DB.users.filter(u => 
        u.subscription?.active && 
        (!u.subscription.expiresAt || u.subscription.expiresAt > Date.now())
    ).length;
    
    const connectedServers = Object.values(DB.servers).filter(s => 
        s.connected && s.lastUpdate && (Date.now() - s.lastUpdate < 60000)
    ).length;
    
    res.json({
        success: true,
        stats: {
            totalUsers,
            totalServers,
            activeSubscriptions,
            connectedServers,
            totalPlayers: Object.values(DB.servers).reduce((sum, s) => 
                sum + Object.keys(s.players || {}).length, 0
            )
        }
    });
});

// ==========================================
// SUBSCRIPTION ROUTES
// ==========================================

// Get Subscription Plans
app.get('/api/subscription/plans', (req, res) => {
    res.json({
        success: true,
        plans: [
            {
                id: 'free',
                name: 'مجاني',
                price: 0,
                duration: null,
                features: {
                    servers: 1,
                    players: 32,
                    webhooks: 2,
                    converter: false,
                    scanner: false,
                    bot: 'shared',
                    backups: false,
                    removeBranding: false
                }
            },
            {
                id: 'basic',
                name: 'أساسي',
                price: 9.99,
                duration: 30,
                features: {
                    servers: 3,
                    players: 64,
                    webhooks: 5,
                    converter: true,
                    scanner: true,
                    bot: 'shared',
                    backups: false,
                    removeBranding: false
                }
            },
            {
                id: 'pro',
                name: 'احترافي',
                price: 19.99,
                duration: 30,
                features: {
                    servers: 10,
                    players: 128,
                    webhooks: 20,
                    converter: true,
                    scanner: true,
                    bot: 'custom',
                    backups: true,
                    removeBranding: true
                }
            },
            {
                id: 'lifetime',
                name: 'مدى الحياة',
                price: 99.99,
                duration: null,
                features: {
                    servers: 999,
                    players: 999,
                    webhooks: 999,
                    converter: true,
                    scanner: true,
                    bot: 'custom',
                    backups: true,
                    removeBranding: true
                }
            }
        ]
    });
});

// Check Subscription Status
app.get('/api/subscription/status', authMiddleware, (req, res) => {
    const user = findUserById(req.user.id);
    
    if (!user) {
        return res.status(404).json({ success: false });
    }
    
    const active = isSubscriptionActive(user.id);
    
    res.json({
        success: true,
        subscription: {
            ...user.subscription,
            active,
            daysRemaining: user.subscription?.expiresAt 
                ? Math.max(0, Math.ceil((user.subscription.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)))
                : null
        }
    });
});

// ==========================================
// SPA FALLBACK
// ==========================================

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// START SERVER
// ==========================================

app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   ██╗     ██╗███╗   ██╗██╗   ██╗██╗  ██╗                     ║
║   ██║     ██║████╗  ██║██║   ██║╚██╗██╔╝                     ║
║   ██║     ██║██╔██╗ ██║██║   ██║ ╚███╔╝                      ║
║   ██║     ██║██║╚██╗██║██║   ██║ ██╔██╗                      ║
║   ███████╗██║██║ ╚████║╚██████╔╝██╔╝ ██╗                     ║
║   ╚══════╝╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝                     ║
║                                                               ║
║   LimitGuard SaaS Platform v2.0                               ║
║   Running on port ${PORT}                                        ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
    `);
});