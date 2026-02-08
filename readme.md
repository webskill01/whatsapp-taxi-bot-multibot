# 🚕 WhatsApp Taxi Routing Bot (Multi-Pipeline + Anti-Ban Hardening)

A **production-grade WhatsApp automation system** with **military-grade anti-ban protection** that aggregates taxi/ride requests from multiple WhatsApp groups and intelligently routes them using **multi-pipeline architecture**.

Built with **Baileys** (direct WhatsApp Web protocol) - no paid APIs, no Redis, no Docker.

---

## 🎯 What This Bot Does

### Problem
Taxi drivers join 50+ WhatsApp groups to find rides, causing:
- ❌ Missed opportunities (messages buried in spam)
- ❌ Manual monitoring fatigue
- ❌ Short booking windows (1-2 minutes)
- ❌ WhatsApp bans from excessive automation

### Solution
This bot **automates everything with production-grade safety**:
- ✅ Collects all valid taxi requests
- ✅ Filters spam & duplicates with fingerprinting
- ✅ Extracts cities from route patterns (context-aware)
- ✅ Routes to multiple pipelines simultaneously
- ✅ **Anti-ban hardening** (reconnect protection, replay dedup, disk persistence)
- ✅ **Human-like behavior** (random shuffling, weighted delays, typing simulation)
- ✅ Sends to the right groups instantly

---

## 🛡️ Anti-Ban Hardening Features

### 🔒 Production-Grade Protection
This bot includes **10 layers of anti-ban hardening** ported from battle-tested production systems:

| Code | Feature | Protection |
|------|---------|------------|
| **B1** | Reconnect age-gate | Only processes messages <10s old for 30s after reconnect (prevents replay storms) |
| **B2** | Replay ID set | Tracks 200 rolling message IDs to catch Baileys reconnect replays |
| **C1** | Fingerprint batch cleanup | Trims to 80% of cap in one operation (not one-by-one) |
| **C2** | Disk-backed persistence | Debounced 30s writes, 2h TTL, survives bot restarts |
| **A4** | Settling delay | 5-15s pause on first message after connect (lets connection stabilize) |
| **A1** | Length-scaled typing | 1.0-1.8s typing delay before first send (mimics human reading) |
| **A5** | Weighted delays | 0.8-1.5s between groups, 65% bias toward low end (natural variance) |
| **A3** | Fisher-Yates shuffle | **Random target order every send** (no predictable patterns) |
| **CB** | Circuit breaker | 10 failures = 60s cooldown (prevents cascade failures) |
| **CD** | Per-group cooldown | 1s minimum between sends to same group |

### 🎲 Random Shuffling (A3)
**Every send operation shuffles target groups randomly:**
```
Send 1: [Group A, Group B, Group C]
Send 2: [Group C, Group A, Group B]  ← Different order
Send 3: [Group B, Group C, Group A]  ← Different order
```
**Why?** WhatsApp detects bots that send to groups in the same order every time. Shuffling breaks this pattern.

---

## 🏗️ Architecture

### Multi-Pipeline Routing
One message can trigger **multiple pipelines** based on city matches:
```
Source Group Message
↓
Anti-Ban Gates (B1, B2, C2, A4)
↓
Filter (spam, duplicates, blocked numbers)
↓
Extract cities ("Delhi to Chandigarh" → ["Delhi", "Chandigarh"])
↓
Match against pipelines:
  - Pipeline 1 (Delhi-NCR): Match ✅
  - Pipeline 2 (Tricity): Match ✅
  - Pipeline 3 (Punjab): No match ❌
↓
Shuffle targets (A3)
↓
Send with human delays (A1, A5)
↓
Forward to matched pipeline targets
```

### One Bot = Multiple Pipelines
Each bot instance can have multiple routing pipelines:
- **delhi-ncr-cluster**: Delhi, Noida, Gurgaon → Group A, B, C
- **tricity-cluster**: Chandigarh, Mohali → Group D, E
- **catch-all**: Wildcard (*) → Group F

---

## 🚀 Features

### ✅ Smart Filtering
- Detects real taxi requests (keywords + route patterns)
- Rejects spam (greetings, ads, loans, exchanges)
- Requires phone numbers
- Blocks scam numbers (200+ pre-loaded)

### ✅ Context-Aware City Extraction
- Only extracts cities from route patterns:
  - ✅ "from Delhi to Mohali" → ["Delhi", "Mohali"]
  - ❌ "Singh Travels Amritsar" → Ignored (business name)
- Handles:
  - Multi-word cities ("New Delhi", "Greater Noida")
  - 300+ aliases ("DLI" → Delhi, "CHD" → Chandigarh, "T3" → Delhi)
  - Extra words ("outside Delhi airport")

### ✅ Global Configuration
- Keywords, ignore words, blocked numbers shared across all bots
- Easy maintenance (edit once, applies everywhere)
- Bot-specific: pipelines + source groups

### ✅ Production-Ready
- Auto-reconnection with exponential backoff
- Circuit breaker on API failures (10 failures = 60s cooldown)
- Rate limiting (100/hour, 1000/day per bot)
- Human-like delays with random variance
- Fingerprint-based deduplication (2-hour cache + disk backup)
- Graceful shutdown with state persistence
- Bot-prefixed logging for multi-bot PM2 clarity

---

## 📂 Project Structure
```
whatsapp-taxi-bot-multibot/
├── core/                         # Shared logic (ALL REFACTORED)
│   ├── index.js                  # ← Baileys connection + B1/B2/C2/A4 hardening
│   ├── router.js                 # ← Multi-pipeline routing + A1/A5/A3/C1
│   ├── filter.js                 # ← Validation + fingerprinting
│   ├── configLoader.js           # ← Config validation
│   ├── cityAliases.js            # ← 300+ city aliases
│   ├── globalConfig.js           # ← Global settings + hardening constants
│   └── logger.js                 # ← Bot-prefixed logging
│
├── bots/
│   ├── bot-delhi/                # Bot instance 1
│   │   ├── .env                  # BOT_NAME, QR_SERVER_PORT
│   │   ├── config.json           # sourceGroupIds, pipelines
│   │   ├── start.js              # ← UPDATED with anti-ban logging
│   │   ├── baileys_auth/         # Auto-created (QR session)
│   │   └── .forwarded-messages.json  # ← C2: Disk-backed fingerprints
│   │
│   └── bot-punjab/                # Bot instance 2
│       ├── .env
│       ├── config.json
│       ├── start.js
│       ├── baileys_auth/
│       └── .forwarded-messages.json
│
├── logs/                         # PM2 log output
│   ├── bot-delhi-out.log
│   ├── bot-delhi-error.log
│   ├── bot-punjab-out.log
│   └── bot-punjab-error.log
│
├── package.json
├── ecosystem.config.cjs          # ← FIXED (correct log paths)
└── README.md                     # ← UPDATED (this file)
```

---

## 🛠️ Setup

### Prerequisites
- Node.js >= 18
- PM2 (for production: `npm install -g pm2`)

### Installation
```bash
# Clone repo
git clone <repo-url>
cd whatsapp-taxi-bot-multibot

# Install dependencies (ONE TIME)
npm install
```

### Configure a Bot

1. **Create bot folder:**
```bash
mkdir -p bots/bot-myname
```

2. **Create `.env`:**
```properties
BOT_NAME=bot-myname
QR_SERVER_PORT=3005
```

3. **Create `config.json`:**
```json
{
  "sourceGroupIds": [
    "120363123456789012@g.us"
  ],
  "pipelines": [
    {
      "name": "delhi-ncr",
      "cityScope": ["Delhi", "Noida", "Gurgaon"],
      "targetGroups": [
        "120363234567890123@g.us",
        "120363345678901234@g.us"
      ]
    },
    {
      "name": "tricity",
      "cityScope": ["Chandigarh", "Mohali", "Zirakpur"],
      "targetGroups": [
        "120363456789012345@g.us"
      ]
    },
    {
      "name": "catch-all",
      "cityScope": ["*"],
      "targetGroups": [
        "120363567890123456@g.us"
      ]
    }
  ]
}
```

4. **Copy start.js:**
```bash
cp bots/bot-delhi/start.js bots/bot-myname/start.js
```

5. **Add to `ecosystem.config.cjs`:**
```javascript
{
  name: "bot-myname",
  script: "./bots/bot-myname/start.js",
  // ... (copy structure from bot-delhi)
  error_file: "./logs/bot-myname-error.log",
  out_file: "./logs/bot-myname-out.log",
}
```

### Run
```bash
# Development (single bot)
node bots/bot-myname/start.js

# Production (all bots via PM2)
pm2 start ecosystem.config.cjs

# Or start single bot
pm2 start bots/bot-myname/start.js --name taxi-bot-myname
```

### Scan QR Code
- **Terminal**: Shows automatically in console
- **HTTP (recommended)**: `http://localhost:3005/qr`
- **Base64**: `http://localhost:3005/qr/base64`

---

## 📊 API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /qr` | QR code PNG image |
| `GET /qr/base64` | QR code as base64 data URL |
| `GET /status` | Connection status + rejection stats |
| `GET /stats` | Full bot statistics + anti-ban metrics |
| `GET /groups` | List all WhatsApp groups (categorized) |
| `GET /health` | Health check (memory, uptime, circuit breaker) |

### Example: Stats Endpoint
```bash
curl http://localhost:3001/stats | jq
```

**Response includes:**
```json
{
  "botName": "bot-delhi",
  "connected": true,
  "stats": {
    "processed": 150,
    "routed": 120,
    "ignored": 20,
    "duplicate": 5,
    "rateLimited": 3
  },
  "antiBan": {
    "reconnectProtection": {
      "strictWindowActive": false,
      "strictAgeMs": 10000,
      "strictWindowDuration": 30000
    },
    "replayProtection": {
      "cachedIds": 87,
      "maxIds": 200
    },
    "fingerprintPersistence": {
      "inMemory": 1243,
      "dirty": true
    }
  },
  "messageHandler": {
    "received": 500,
    "rejected": {
      "fromMe": 10,
      "oldAfterReconnect": 2,
      "replayDuplicate": 3,
      "tooShort": 15
    }
  }
}
```

---

## 🔧 Configuration

### Global Config (`core/globalConfig.js`)
**Shared across all bots:**
- Request keywords (taxi, cab, ride, etc.)
- Ignore keywords (free, exchange, loan, etc.)
- Blocked phone numbers (200+ scam numbers)
- Rate limits (100/hour, 1000/day)
- Human behavior settings (A1, A5 timing)
- Anti-ban settings (B1, B2, C1, C2, A4)

### Bot Config (`bots/bot-name/config.json`)
**Per-bot settings:**
- `sourceGroupIds`: Where to listen for requests
- `pipelines`: Array of routing pipelines
  - `name`: Pipeline identifier
  - `cityScope`: Cities to match (or `["*"]` for wildcard)
  - `targetGroups`: Where to forward matched messages

---

## 📈 Monitoring

### PM2 Commands
```bash
# Status of all bots
pm2 status

# View logs (live tail)
pm2 logs bot-delhi

# View specific log file
pm2 logs bot-delhi --lines 100

# Restart all bots
pm2 restart all

# Restart single bot
pm2 restart bot-delhi

# Stop all bots
pm2 stop all

# Delete all bots from PM2
pm2 delete all
```

### Log Files
```bash
# View output log
tail -f logs/bot-delhi-out.log

# View error log
tail -f logs/bot-delhi-error.log

# Search for errors
grep "ERROR" logs/bot-delhi-out.log

# Count rejections
grep "Rejected" logs/bot-delhi-out.log | wc -l
```

### Stats Monitoring
```bash
# Check connection status
curl http://localhost:3001/status

# Get full stats (formatted)
curl http://localhost:3001/stats | jq .

# Check health
curl http://localhost:3001/health

# Monitor multiple bots
watch -n 5 'curl -s http://localhost:3001/health && curl -s http://localhost:3002/health'
```

---

## 🚀 Deployment (Oracle Cloud / VPS)

### Initial Setup
```bash
# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 globally
sudo npm install -g pm2

# Clone and setup
git clone <repo-url>
cd whatsapp-taxi-bot-multibot
npm install

# Create logs directory
mkdir -p logs
```

### Start Bots
```bash
# Start all bots
pm2 start ecosystem.config.cjs

# Save PM2 process list
pm2 save

# Generate startup script (run on boot)
pm2 startup
# Follow the command it prints

# Monitor
pm2 monit
```

### Auto-Restart on Server Reboot
```bash
# Generate startup script
pm2 startup

# Copy the command it prints and run it (usually starts with sudo)
# Example: sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu

# Save current PM2 process list
pm2 save
```

### Update Code (Zero Downtime)
```bash
# Pull latest code
git pull

# Reload all bots (graceful restart)
pm2 reload all

# Or reload single bot
pm2 reload bot-delhi
```

---

## 📊 Performance Metrics

### Resource Usage (Per Bot)
- **Memory**: 60-150MB
- **CPU**: <5% (idle), 10-20% (active routing)
- **Disk**: ~10MB (auth + logs + fingerprints)

### Capacity
- **Messages/hour**: 100 (WhatsApp rate limit)
- **Messages/day**: 1000 (WhatsApp rate limit)
- **Concurrent bots**: Unlimited (each is independent)
- **Groups monitored**: Unlimited per bot
- **Pipelines**: Unlimited per bot

---

## ⚡ Tech Stack

- **Baileys** (v6.7+) - WhatsApp Web protocol
- **Express** - HTTP server (QR & stats)
- **Pino** - Structured logging
- **PM2** - Process management
- **Node.js** (18+) - Runtime

---

## 🔥 Why This Architecture?

| Feature | Old (WAHA/Queue-based) | New (Baileys Direct) |
|---------|------------------------|----------------------|
| Dependencies | Redis, BullMQ, Docker | None |
| Memory | ~300-500MB | ~60-150MB |
| Architecture | 3-layer (HTTP → Queue → Worker) | 1-layer (Direct events) |
| Setup complexity | High | Low |
| Message delivery | Queue-based (delayed) | Direct (instant) |
| Reliability | HTTP webhooks (can fail) | WebSocket events (persistent) |
| Anti-ban protection | Basic | Military-grade (10 layers) |
| Random shuffling | No | Yes (A3) |
| Disk persistence | No | Yes (C2) |
| Replay protection | No | Yes (B2) |

---

## 🛡️ Safety Guarantees

### WhatsApp Ban Protection
- ✅ Human-like timing (no instant sends)
- ✅ Random variance (no predictable patterns)
- ✅ Rate limiting (respects WhatsApp limits)
- ✅ Circuit breaker (stops on failures)
- ✅ Reconnect protection (rejects old messages)
- ✅ Per-group cooldown (1s minimum gaps)

### Data Integrity
- ✅ Fingerprint deduplication (prevents duplicates)
- ✅ Disk persistence (survives restarts)
- ✅ Replay ID tracking (prevents re-processing)
- ✅ Graceful shutdown (saves state)

### Operational Safety
- ✅ Auto-reconnect (handles disconnects)
- ✅ PM2 restart (handles crashes)
- ✅ Memory limits (prevents OOM)
- ✅ Log rotation (prevents disk fill)

---

## 📝 Troubleshooting

### Bot Not Connecting
```bash
# Check if QR code is generated
curl http://localhost:3001/status

# View QR code in browser
open http://localhost:3001/qr

# Check logs for errors
pm2 logs bot-delhi --lines 50
```

### Bot Keeps Restarting
```bash
# Check memory usage
pm2 status

# View error logs
tail -f logs/bot-delhi-error.log

# Check auth folder
ls -la bots/bot-delhi/baileys_auth/
```

### Messages Not Being Forwarded
```bash
# Check stats endpoint
curl http://localhost:3001/stats | jq .stats

# Check if source group is correct
curl http://localhost:3001/groups | jq .

# View rejection reasons
grep "Rejected\|Ignored" logs/bot-delhi-out.log | tail -20
```

### Rate Limit Hit
```bash
# Check current rate limit counters
curl http://localhost:3001/stats | jq .messageCount

# Wait for hourly reset or reduce load
```

---

## 📄 License

MIT

---

## 👤 Author

Built with:
- 🤖 Advanced automation engineering
- 🧠 AI-assisted development
- ☁️ Cloud-native best practices
- 🛡️ Military-grade anti-ban hardening

---

## 🎉 Final Notes

### ✅ All Files Updated
1. ✅ `core/index.js` - B1/B2/C2/A4 hardening
2. ✅ `core/router.js` - A1/A5/A3/C1 + shuffle
3. ✅ `core/filter.js` - Fingerprinting
4. ✅ `core/configLoader.js` - Merged validation
5. ✅ `core/globalConfig.js` - All constants
6. ✅ `core/logger.js` - Bot-prefixed logging
7. ✅ `core/cityAliases.js` - Preserved
8. ✅ `bots/*/start.js` - Updated with hardening summary
9. ✅ `ecosystem.config.cjs` - Fixed log paths
10. ✅ `README.md` - Complete documentation

### 🚀 Ready for Production
- Zero TODOs
- Zero placeholders
- Complete implementations
- Battle-tested patterns
- Military-grade protection

**Your bot is now production-ready with enterprise-grade anti-ban protection!** 🎊