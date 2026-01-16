# 🚕 WhatsApp Taxi Routing Bot (Multi-Pipeline Architecture)

A **production-grade WhatsApp automation system** that aggregates taxi/ride requests from multiple WhatsApp groups, intelligently routes them to the right audience using **multi-pipeline architecture**.

Built with **Baileys** (direct WhatsApp Web protocol) - no paid APIs required.

---

## 🎯 What This Bot Does

### Problem
Taxi drivers join 50+ WhatsApp groups to find rides, causing:
- Missed opportunities (messages buried in spam)
- Manual monitoring fatigue
- Short booking windows (1-2 minutes)

### Solution
This bot **automates everything**:
- ✅ Collects all valid taxi requests
- ✅ Filters spam & duplicates
- ✅ Extracts cities from route patterns
- ✅ Routes to multiple pipelines simultaneously
- ✅ Sends to the right groups instantly

---

## 🏗️ Architecture

### Multi-Pipeline Routing
One message can trigger **multiple pipelines** based on city matches:
```
Source Group Message
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
Forward to target groups from matched pipelines
```

### One Bot = Multiple Pipelines
Each bot instance can have multiple routing pipelines:
- **delhi-ncr-cluster**: Delhi, Noida, Gurgaon → Group A
- **tricity-cluster**: Chandigarh, Mohali → Group B
- **catch-all**: Wildcard (*) → Group C

---

## 🚀 Features

### ✅ Smart Filtering
- Detects real taxi requests (keywords + route patterns)
- Rejects spam (greetings, ads, loans, exchanges)
- Requires phone numbers
- Blocks scam numbers

### ✅ Context-Aware City Extraction
- Only extracts cities from route patterns:
  - ✅ "from Delhi to Mohali" → ["Delhi", "Mohali"]
  - ❌ "Singh Travels Amritsar" → Ignored (business name)
- Handles:
  - Multi-word cities ("New Delhi", "Greater Noida")
  - Aliases ("DLI" → Delhi, "CHD" → Chandigarh)
  - Extra words ("outside Delhi airport")

### ✅ Global Configuration
- Keywords, ignore words, blocked numbers shared across all bots
- Easy maintenance (edit once, applies everywhere)
- Bot-specific: pipelines + source groups

### ✅ Production-Ready
- Auto-reconnection on disconnect
- Circuit breaker on API failures
- Rate limiting (80/hour, 700/day per bot)
- Human-like delays (typing simulation)
- Fingerprint-based deduplication (2-hour cache)
- Graceful shutdown

---

## 📂 Project Structure
```
whatsapp-taxi-bot-multibot/
├── core/                    # Shared logic
│   ├── configLoader.js
│   ├── filter.js
│   ├── router.js
│   ├── index.js
│   ├── logger.js
│   └── globalConfig.js
│
├── bots/
│   ├── bot-delhi/           # Bot instance 1
│   │   ├── .env
│   │   ├── config.json
│   │   ├── start.js
│   │   ├── baileys_auth/    # Auto-created
│   │   └── qr-codes/        # Auto-created
│   │
│   └── bot-tricity/         # Bot instance 2
│       ├── .env
│       ├── config.json
│       ├── start.js
│       ├── baileys_auth/
│       └── qr-codes/
│
├── package.json
├── ecosystem.config.cjs     # PM2 config
└── README.md
```

---

## 🛠️ Setup

### Prerequisites
- Node.js >= 18
- PM2 (for production)

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
QR_SERVER_PORT=3003
```

3. **Create `config.json`:**
```json
{
  "sourceGroupIds": [
    "120363123456789012@g.us"
  ],
  "pipelines": [
    {
      "name": "my-pipeline",
      "cityScope": ["Delhi", "Noida"],
      "targetGroups": [
        "120363234567890123@g.us"
      ]
    }
  ]
}
```

4. **Copy start.js:**
```bash
cp bots/bot-delhi/start.js bots/bot-myname/start.js
```

### Run
```bash
# Development
node bots/bot-myname/start.js

# Production (PM2)
pm2 start bots/bot-myname/start.js --name taxi-bot-myname

# Or use ecosystem file
pm2 start ecosystem.config.cjs
```

### Scan QR Code
- Terminal: Shows automatically
- PNG: `bots/bot-myname/qr-codes/qr-*.png`
- HTTP: `http://localhost:3003/qr`

---

## 📊 API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /qr` | QR code image |
| `GET /status` | Connection status |
| `GET /stats` | Bot statistics |
| `GET /groups` | List all WhatsApp groups |

---

## 🔧 Configuration

### Global Config (`core/globalConfig.js`)
- Request keywords (shared across all bots)
- Ignore keywords
- Blocked phone numbers
- Rate limits
- Human behavior settings

### Bot Config (`bots/bot-name/config.json`)
- Source group IDs
- Pipelines (name, cityScope, targetGroups)

---

## 📈 Monitoring
```bash
# PM2 status
pm2 status

# View logs
pm2 logs taxi-bot-delhi

# Stats endpoint
curl http://localhost:3001/stats
```

---

## 🚀 Deployment (Oracle Cloud)
```bash
# Install PM2
npm install -g pm2

# Start all bots
pm2 start ecosystem.config.cjs

# Save PM2 config
pm2 save

# Auto-start on reboot
pm2 startup
```

---

## ⚡ Tech Stack

- **Baileys** - WhatsApp Web protocol
- **Express** - HTTP server (QR & stats)
- **Pino** - Structured logging
- **PM2** - Process management

---

## 🎉 Why This Architecture?

| Feature | Old (WAHA) | New (Baileys) |
|---------|-----------|---------------|
| Dependencies | Redis, BullMQ, Docker | None |
| Memory | ~300-500MB | ~60-150MB |
| Architecture | 3-layer | 1-layer |
| Setup complexity | High | Low |
| Message delivery | Queue-based | Direct |
| Reliability | HTTP webhooks | WebSocket events |

---

## 📝 License

MIT

---

## 👤 Author

Built with automation, AI assistance, and cloud-native practices.