const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// CONFIG - غيّر هذه إذا أردت!
// ==========================================
const CONFIG = {
    API_KEY: 'sk_my_secret_key_12345',
    LICENSE_KEY: 'LG-7F3K9-AX2M5-PQ8R4',
};

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let serverData = { connected: false, lastUpdate: null, stats: {}, players: {} };
let pendingCommands = [];

// ==========================================
// ENDPOINTS
// ==========================================

// License Check (لحل مشكلة 403)
app.post('/api/license/check', (req, res) => {
    const { license, apiKey } = req.body;
    
    if (apiKey !== CONFIG.API_KEY) {
        return res.status(401).json({ success: false, message: 'Invalid API key' });
    }
    if (license !== CONFIG.LICENSE_KEY) {
        return res.status(403).json({ success: false, message: 'Invalid license' });
    }
    
    res.json({ success: true, message: 'License valid' });
});

// Server Connect
app.post('/api/server/connect', (req, res) => {
    const { license, apiKey, serverName, maxPlayers } = req.body;
    
    console.log('[API] Connect request from:', license);
    
    if (apiKey !== CONFIG.API_KEY) {
        return res.status(401).json({ success: false, message: 'Invalid API key' });
    }
    if (license !== CONFIG.LICENSE_KEY) {
        return res.status(403).json({ success: false, message: 'Invalid license' });
    }
    
    serverData.connected = true;
    serverData.lastUpdate = Date.now();
    serverData.serverName = serverName || 'FiveM Server';
    
    console.log('[API] ✓ Server connected:', serverName);
    
    res.json({ success: true });
});

// Server Update
app.post('/api/server/update', (req, res) => {
    const { license, stats, players } = req.body;
    
    serverData.lastUpdate = Date.now();
    serverData.connected = true;
    if (stats) serverData.stats = { ...serverData.stats, ...stats };
    if (players) serverData.players = players;
    
    res.json({ success: true });
});

// Heartbeat
app.post('/api/server/heartbeat', (req, res) => {
    serverData.lastUpdate = Date.now();
    serverData.connected = true;
    res.json({ success: true });
});

// Status
app.get('/api/status', (req, res) => {
    if (serverData.lastUpdate && (Date.now() - serverData.lastUpdate > 30000)) {
        serverData.connected = false;
    }
    res.json(serverData);
});

// Commands
app.post('/api/command', (req, res) => {
    pendingCommands.push({ ...req.body, timestamp: Date.now() });
    res.json({ success: true });
});

app.get('/api/commands', (req, res) => {
    res.json(pendingCommands);
    pendingCommands = [];
});

// SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log('========================================');
    console.log('LimitGuard Backend Started');
    console.log('Port:', PORT);
    console.log('License:', CONFIG.LICENSE_KEY);
    console.log('========================================');
});