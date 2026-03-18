// ==========================================
// LIMITGUARD BACKEND - FULL VERSION
// ==========================================

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// CONFIGURATION - غيّر هذه المفاتيح!
// ==========================================

const CONFIG = {
    // المفتاح السري - يجب أن يطابق ما في config.lua
    API_KEY: 'sk_my_secret_key_12345',
    
    // مفتاح الترخيص - يجب أن يطابق ما في config.lua
    LICENSE_KEY: 'LLS-2009204-199-bd',
};

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// DATA STORAGE
// ==========================================

let serverData = {
    connected: false,
    lastUpdate: null,
    license: null,
    serverName: 'Unknown Server',
    maxPlayers: 128,
    stats: {
        players: 0,
        tps: 0,
        uptime: 0,
        resources: 0,
        resourcesRunning: 0,
        memory: '0 MB'
    },
    players: {},
    events: [],
    resources: []
};

let pendingCommands = [];
let blacklists = [];
let warnings = {};

// ==========================================
// API VERIFICATION
// ==========================================

function verifyAPI(req, res, next) {
    const authHeader = req.headers['authorization'];
    const apiKey = authHeader && authHeader.replace('Bearer ', '');
    const license = req.body.license || req.query.license;
    
    if (apiKey !== CONFIG.API_KEY) {
        return res.status(401).json({ success: false, message: 'Invalid API key' });
    }
    
    if (license && license !== CONFIG.LICENSE_KEY) {
        return res.status(403).json({ success: false, message: 'License mismatch' });
    }
    
    next();
}

// ==========================================
// SERVER ENDPOINTS (From FiveM)
// ==========================================

// Server Connect
app.post('/api/server/connect', (req, res) => {
    const { license, apiKey, serverName, maxPlayers, resources } = req.body;
    
    if (apiKey !== CONFIG.API_KEY || license !== CONFIG.LICENSE_KEY) {
        return res.status(403).json({ success: false, message: 'Invalid credentials' });
    }
    
    serverData.connected = true;
    serverData.lastUpdate = Date.now();
    serverData.license = license;
    serverData.serverName = serverName || 'FiveM Server';
    serverData.maxPlayers = maxPlayers || 128;
    serverData.stats.resources = resources || 0;
    
    addEvent('server_connect', { serverName });
    
    console.log(`[LimitGuard] Server connected: ${serverName}`);
    
    res.json({ success: true });
});

// Server Update
app.post('/api/server/update', verifyAPI, (req, res) => {
    const { stats, players } = req.body;
    
    serverData.lastUpdate = Date.now();
    serverData.connected = true;
    
    if (stats) {
        serverData.stats = { ...serverData.stats, ...stats };
    }
    
    if (players) {
        serverData.players = players;
    }
    
    res.json({ success: true });
});

// Heartbeat
app.post('/api/server/heartbeat', verifyAPI, (req, res) => {
    serverData.lastUpdate = Date.now();
    serverData.connected = true;
    res.json({ success: true });
});

// Player Connecting
app.post('/api/player/connecting', verifyAPI, (req, res) => {
    const { player } = req.body;
    
    addEvent('player_join', player);
    
    res.json({ success: true });
});

// Player Disconnecting
app.post('/api/player/disconnecting', verifyAPI, (req, res) => {
    const { player, reason } = req.body;
    
    addEvent('player_leave', { ...player, reason });
    
    res.json({ success: true });
});

// Player Kicked
app.post('/api/player/kicked', verifyAPI, (req, res) => {
    const { player, reason, admin } = req.body;
    
    addEvent('kick', { ...player, reason, admin });
    
    res.json({ success: true });
});

// Player Banned
app.post('/api/player/banned', verifyAPI, (req, res) => {
    const { player, reason, duration, admin } = req.body;
    
    blacklists.push({
        type: 'license',
        value: player.identifier,
        reason,
        admin,
        timestamp: Date.now()
    });
    
    addEvent('ban', { ...player, reason, duration, admin });
    
    res.json({ success: true });
});

// Security Alert
app.post('/api/security/suspicious', verifyAPI, (req, res) => {
    const { activity } = req.body;
    
    addEvent('security', activity);
    
    res.json({ success: true });
});

// ==========================================
// PANEL ENDPOINTS (From Website)
// ==========================================

// Get Server Status
app.get('/api/status', (req, res) => {
    // Check timeout (30 seconds)
    if (serverData.lastUpdate && (Date.now() - serverData.lastUpdate > 30000)) {
        serverData.connected = false;
    }
    
    res.json(serverData);
});

// Get Pending Commands (Server polls this)
app.get('/api/commands', verifyAPI, (req, res) => {
    res.json(pendingCommands);
    pendingCommands = [];
});

// Send Command (From Panel)
app.post('/api/command', (req, res) => {
    const { command, data } = req.body;
    
    pendingCommands.push({
        command,
        data,
        timestamp: Date.now()
    });
    
    addEvent('admin_command', { command, data });
    
    res.json({ success: true, message: 'Command queued' });
});

// Get Players
app.get('/api/players', (req, res) => {
    res.json(Object.values(serverData.players));
});

// Get Events
app.get('/api/events', (req, res) => {
    res.json(serverData.events);
});

// Get Blacklist
app.get('/api/blacklist', (req, res) => {
    res.json(blacklists);
});

// Add to Blacklist
app.post('/api/blacklist', (req, res) => {
    const { type, value, reason } = req.body;
    
    blacklists.push({
        type,
        value,
        reason,
        admin: 'Panel',
        timestamp: Date.now()
    });
    
    res.json({ success: true });
});

// Remove from Blacklist
app.delete('/api/blacklist/:index', (req, res) => {
    const index = parseInt(req.params.index);
    if (index >= 0 && index < blacklists.length) {
        blacklists.splice(index, 1);
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false });
    }
});

// Get Warnings
app.get('/api/warnings/:identifier', (req, res) => {
    res.json(warnings[req.params.identifier] || []);
});

// Add Warning
app.post('/api/warnings', (req, res) => {
    const { identifier, reason } = req.body;
    
    if (!warnings[identifier]) {
        warnings[identifier] = [];
    }
    
    warnings[identifier].push({
        reason,
        admin: 'Panel',
        timestamp: Date.now()
    });
    
    // Queue command for server
    pendingCommands.push({
        command: 'warning',
        data: { identifier, reason }
    });
    
    res.json({ success: true });
});

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function addEvent(type, data) {
    serverData.events.unshift({
        type,
        data,
        timestamp: Date.now()
    });
    
    // Keep only last 100 events
    if (serverData.events.length > 100) {
        serverData.events = serverData.events.slice(0, 100);
    }
}

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
╔═══════════════════════════════════════════════════════════╗
║                    LimitGuard Backend                     ║
╠═══════════════════════════════════════════════════════════╣
║  Server running on port ${PORT}                              ║
║  License: ${CONFIG.LICENSE_KEY}                              ║
╚═══════════════════════════════════════════════════════════╝
    `);
});