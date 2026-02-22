# GeosLogHub

Central Log Ingest Service — Railway → Grafana Cloud

A lightweight NestJS (Fastify) service that accepts logs/events from any source, normalises them into a consistent OTLP schema, and forwards them to Grafana Cloud. One endpoint for your entire stack.

---

## Architecture

```
Client apps (Twilio / Vercel / Railway / Chrome / Supabase / custom)
        │  POST /ingest/log|twilio|vercel
        │  x-loghub-source + x-loghub-key
        ▼
  ┌─────────────┐   normalise + sanitize PII   ┌──────────────────────┐
  │  LogHub API │ ─────────────────────────►  │  Grafana Cloud OTLP  │
  │  (Railway)  │                              │  /otlp/v1/logs       │
  └─────────────┘                              └──────────────────────┘
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GRAFANA_OTLP_LOGS_URL` | ✅ | — | Grafana Cloud OTLP endpoint |
| `GRAFANA_OTLP_AUTH` | ✅ | — | `Basic <base64(instanceId:apiKey)>` |
| `API_KEYS_JSON` | ✅ | — | JSON map of `source → ingest key` |
| `DEFAULT_ENV` | — | `prod` | Fallback `env` label |
| `MAX_BODY_KB` | — | `256` | Max request body size in KB |
| `ALLOW_PII` | — | `false` | Set `true` to disable PII masking |
| `PORT` | — | `3000` | HTTP port (Railway sets this automatically) |

### Generating `GRAFANA_OTLP_AUTH`

```bash
# instanceId = your Grafana Cloud stack numeric ID
# apiKey    = a Grafana Cloud API token with logs:write scope
echo -n "instanceId:apiKey" | base64
# → paste result after "Basic " in GRAFANA_OTLP_AUTH
```

### Example `API_KEYS_JSON`

```json
{
  "twilio":   "TWILIO_INGEST_KEY_123",
  "vercel":   "VERCEL_INGEST_KEY_123",
  "chrome":   "CHROME_INGEST_KEY_123",
  "railway":  "RAILWAY_INGEST_KEY_123",
  "supabase": "SUPABASE_INGEST_KEY_123"
}
```

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill in env vars
cp .env.example .env

# 3. Start in watch mode
npm run start:dev
```

---

## Endpoints

### `GET /health`

```bash
curl http://localhost:3000/health
# → { "ok": true }
```

---

### `POST /ingest/log` — Generic log ingest

**Headers**

| Header | Value |
|---|---|
| `x-loghub-source` | `railway` \| `vercel` \| `twilio` \| `chrome` \| `supabase` \| `custom` |
| `x-loghub-key` | Matching key from `API_KEYS_JSON` |
| `Content-Type` | `application/json` |

**Body**

```json
{
  "service": "leadbridge-api",
  "app":     "leadbridge",
  "env":     "prod",
  "level":   "info",
  "message": "something happened",
  "attrs": {
    "request_id": "req_123",
    "lead_id":    "L_456",
    "callSid":    "CA_789"
  }
}
```

**Example**

```bash
curl -X POST "$LOGHUB_URL/ingest/log" \
  -H "Content-Type: application/json" \
  -H "x-loghub-source: railway" \
  -H "x-loghub-key: RAILWAY_INGEST_KEY_123" \
  -d '{"service":"leadbridge-api","app":"leadbridge","env":"prod","level":"info","message":"hello","attrs":{"request_id":"req_1"}}'
```

---

### `POST /ingest/twilio` — Twilio webhook ingest

Send any raw Twilio webhook payload; the service extracts `CallSid`, `MessageSid`, `AccountSid`, `CallStatus`, `Direction` automatically.

```bash
curl -X POST "$LOGHUB_URL/ingest/twilio" \
  -H "Content-Type: application/json" \
  -H "x-loghub-source: twilio" \
  -H "x-loghub-key: TWILIO_INGEST_KEY_123" \
  -d '{"CallSid":"CA123","From":"+18135551212","To":"+18135559876","CallStatus":"no-answer"}'
```

---

### `POST /ingest/vercel` — Vercel log drain ingest

Accepts arbitrary JSON from Vercel's log drain. The full body is stored as the log message.

```bash
curl -X POST "$LOGHUB_URL/ingest/vercel" \
  -H "Content-Type: application/json" \
  -H "x-loghub-source: vercel" \
  -H "x-loghub-key: VERCEL_INGEST_KEY_123" \
  -d '{"level":"error","message":"Function timeout","deploymentId":"dpl_xyz"}'
```

---

## Response Codes

| Code | Meaning |
|---|---|
| `200 { ok, id, forwarded: true }` | Log accepted and forwarded to Grafana successfully |
| `202 { ok, id, forwarded: false }` | Log accepted but Grafana push failed (logged locally) |
| `401` | Missing or invalid `x-loghub-source` / `x-loghub-key` |
| `413` | Body exceeds `MAX_BODY_KB` limit |
| `429` | Rate limit exceeded for this source |

Every response includes a UUID `id` that is also stored as `ingest_id` in the forwarded log attributes.

---

## Normalization

All ingested logs are mapped to these OTLP resource attributes:

| Attribute | Source |
|---|---|
| `service.name` | `body.service` (fallback: `loghub`) |
| `app` | `body.app` (fallback: `unknown`) |
| `env` | `body.env` (fallback: `DEFAULT_ENV`) |
| `source` | `x-loghub-source` header |
| `level` | `body.level` (fallback: `info`) |
| `ts` | Server receive time (ISO 8601) |
| `ingest_id` | Auto-generated UUID |

Optional attributes forwarded when present: `request_id`, `lead_id`, `callSid`, `messageSid`, `user_id`, `phone_hash`.

---

## PII Sanitization

When `ALLOW_PII=false` (default):

- **Phone numbers** → masked to last 2 digits, e.g. `+1-813-555-1212` → `***12`
- **Emails** → local part masked, e.g. `john@example.com` → `j***@example.com`
- Attribute `pii_sanitized=true` is added when masking occurs

Set `ALLOW_PII=true` to disable all sanitization.

---

## Grafana Explore Queries

After logs are flowing, use these queries in **Grafana → Explore → Loki**:

```logql
# All logs from LogHub
{service_name="loghub"}

# Logs from a specific source
{source="twilio"}

# Logs from a specific service
{service_name="leadbridge-api"}

# Find a specific Twilio call
{source="twilio"} | json | callSid="CA123..."

# Errors only
{env="prod"} | json | level="error"
```

---

## Deploying to Railway

1. Push this repo to GitHub
2. Create a new Railway project → **Deploy from GitHub repo**
3. Set all required environment variables in Railway's dashboard (Variables tab)
4. Railway auto-detects the `Dockerfile` and the `railway.toml` health check

The service listens on `process.env.PORT` which Railway injects automatically.

---

## Running Tests

```bash
npm test
npm run test:cov
```

Tests cover: auth guard, PII sanitisation, payload truncation, OTLP payload builder.
