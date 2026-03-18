const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Data storage (in memory - resets on restart)
let serverData = {
    connected: false,
    lastUpdate: null,
    stats: {},
    players: []
};

// API Key (change this!)
const API_KEY = 'your_secret_api_key_here';

// ==========================================
// API ENDPOINTS
// ==========================================

// Verify API key middleware
function verifyAPI(req, res, next) {
    const authHeader = req.headers['authorization'];
    const key = authHeader && authHeader.replace('Bearer ', '');
    
    if (key !== API_KEY) {
        return res.status(401).json({ success: false, message: 'Invalid API key' });
    }
    next();
}

// Server connects and sends data
app.post('/api/server/update', verifyAPI, (req, res) => {
    const { license, stats, players } = req.body;
    
    serverData = {
        connected: true,
        lastUpdate: Date.now(),
        license,
        stats: stats || {},
        players: players || []
    };
    
    res.json({ success: true });
});

// Server heartbeat
app.post('/api/server/heartbeat', verifyAPI, (req, res) => {
    serverData.lastUpdate = Date.now();
    serverData.connected = true;
    res.json({ success: true });
});

// Panel reads data
app.get('/api/status', (req, res) => {
    // Check if server is still connected (timeout after 30 seconds)
    if (serverData.lastUpdate && (Date.now() - serverData.lastUpdate > 30000)) {
        serverData.connected = false;
    }
    
    res.json(serverData);
});

// Command from panel to server (via polling)
let pendingCommands = [];

app.post('/api/command', (req, res) => {
    const { command, data } = req.body;
    pendingCommands.push({ command, data, timestamp: Date.now() });
    res.json({ success: true });
});

app.get('/api/commands', verifyAPI, (req, res) => {
    res.json(pendingCommands);
    pendingCommands = []; // Clear after reading
});

// SPA fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`LimitGuard Backend running on port ${PORT}`);
});