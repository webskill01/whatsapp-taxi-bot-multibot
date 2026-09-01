# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Running individual bots directly
```bash
node bots/bot-delhi/start.js
node bots/bot-sachin/start.js
node bots/bot-aayush/start.js
```

### PM2 process management (production)
```bash
npm run pm2:start     # Start all bots via ecosystem.config.cjs
npm run pm2:status    # Check status
npm run pm2:logs      # Stream logs
npm run pm2:restart   # Restart all
npm run pm2:stop      # Stop all
```

### Cleanup auth/state files
```bash
npm run clean         # Removes .forwarded-messages.json and baileys_auth dirs
```

## Architecture

This is a multi-bot WhatsApp automation system built on `@whiskeysockets/baileys`. Multiple independent bot instances each run the same core engine but with different `config.json` files defining which WhatsApp groups they listen to and where they route messages.

### Bot instance layout
```
bots/
  bot-delhi/
    start.js       # Entry point — loads config, calls core startBot()
    config.json    # sourceGroupIds + pipelines
    .env           # BOT_NAME, QR_SERVER_PORT, STATS_PORT
    baileys_auth/  # WhatsApp session (auto-created, gitignored)
  bot-sachin/      # Same structure
  bot-aayush/
  bot-promoter/
```

### Core engine (`core/`)

| File | Role |
|---|---|
| `index.js` | `startBot()` — Baileys socket lifecycle, reconnect logic, dedup, QR HTTP server |
| `configLoader.js` | Loads and validates `config.json` + `.env`, merges with `globalConfig.js` |
| `router.js` | `processMessage()` — validation pipeline, city matching, sequential send loop |
| `filter.js` | `isTaxiRequest()`, `extractCities()`, `hasPhoneNumber()`, `containsBlockedNumber()` |
| `cityAliases.js` | Alias map normalizing city spellings/typos to canonical names |
| `globalConfig.js` | Shared constants: keywords, blocked numbers, rate limits, anti-ban timing |
| `logger.js` | `createLogger(botId)` — pino-based logger with bot-identity prefix |

### Message flow

1. Baileys socket receives a group message in `index.js`
2. Age check (max 5 min old), replay ID dedup, fingerprint dedup
3. `processMessage(sock, text, sourceGroup, config, stats, log)` called in `router.js`
4. Fast validation: `isTaxiRequest()` → blocked number check → `hasPhoneNumber()` → rate limit
5. 2–7s randomized processing delay (only applied after all validation passes)
6. For each pipeline in `config.pipelines`:
   - If `cityScope: ["*"]` — wildcard, always matches
   - Otherwise: `extractCities()` checks if pickup OR drop city is in the pipeline's `cityScope`
7. Matched pipelines send the message to their `targetGroups` sequentially with human-like delays

### `config.json` structure (per bot)

```json
{
  "sourceGroupIds": ["<id>@g.us"],
  "pipelines": [
    {
      "name": "pipeline-name",
      "cityScope": ["Delhi", "Noida"],   // or ["*"] for wildcard
      "targetGroups": ["<id>@g.us"]
    }
  ]
}
```

Group IDs must end with `@g.us`. The same message can match multiple pipelines.

### Anti-ban protections

- **B1** Reconnect age gate — ignores messages older than 10s for the first 30s after reconnect
- **B2** Rolling replay ID set (200 IDs) — deduplicates by WhatsApp message ID
- **C1/C2** Fingerprint deduplication with debounced disk writes (30s) to `.forwarded-messages.json`
- **A1** Typing delay scaled by message length (1.0–1.8s)
- **A3** Fisher-Yates shuffle of target group order before each send
- **A4** Settling delay of 5–15s after initial connection
- **A5** Weighted between-group gaps (0.8–1.5s, biased low)
- Circuit breaker: opens after 10 consecutive failures, resets after 60s
- Per-group 1s send cooldown

### PM2 staggered starts

Bots must start with 20s gaps to avoid WhatsApp simultaneous connection detection:
- bot-delhi: 0s (port 3001)
- bot-sachin: 20s (port 3002)
- bot-aayush: 40s (port 3004)
- bot-promoter: 60s (port 3005)

Each bot exposes a QR code HTTP endpoint at its `STATS_PORT` for initial WhatsApp pairing.

### Adding a new bot

1. Copy an existing bot directory (e.g. `bots/bot-delhi/`) to `bots/bot-newname/`
2. Edit `config.json` with the correct group IDs and pipelines
3. Edit `.env` with a unique `BOT_NAME` and `STATS_PORT`
4. Add an entry to `ecosystem.config.cjs` with `start_delay` incremented by 20000ms from the last bot
5. Add a `start:newname` script to `package.json`

### Modifying global behavior

- **Keywords / ignore list / blocked numbers**: edit `core/globalConfig.js`
- **City name recognition**: edit `core/cityAliases.js`
- **Anti-ban timing constants**: edit the `humanBehavior`, `reconnect`, `deduplication`, and `circuitBreaker` sections of `core/globalConfig.js`
