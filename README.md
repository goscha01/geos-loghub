# GeosLogHub
logs gathering  for geos apps
ASK — Build “LogHub” Central Log Ingest Service (Railway → Grafana Cloud)
Goal

Create a small NestJS service (“loghub”) that:

exposes simple HTTP endpoints to receive logs/events from multiple sources

normalizes them into a consistent schema (labels/attributes)

forwards them to Grafana Cloud OTLP Logs (/otlp/v1/logs)

returns an ACK quickly (fast, reliable, safe)

Why

This gives you one central place where your AI agent can query logs later and every app can dump logs/events without custom Grafana integration.

Requirements
Tech

NestJS (Fastify or Express ok)

Node 20+

Deployed on Railway

No database required for MVP (optional in Phase 2)

Uses fetch (native Node 18+)

Environment variables (Railway)

GRAFANA_OTLP_LOGS_URL = https://otlp-gateway-prod-us-east-2.grafana.net/otlp/v1/logs

GRAFANA_OTLP_AUTH = Basic <base64(instanceId:token)>

DEFAULT_ENV = prod (or dev)

API_KEYS_JSON = JSON map of source keys (see below)

MAX_BODY_KB = 256 (default)

ALLOW_PII = false (default)

Example API_KEYS_JSON:

{
  "twilio": "TWILIO_INGEST_KEY_123",
  "vercel": "VERCEL_INGEST_KEY_123",
  "chrome": "CHROME_INGEST_KEY_123",
  "railway": "RAILWAY_INGEST_KEY_123",
  "supabase": "SUPABASE_INGEST_KEY_123"
}

Auth mechanism:

Clients send header: x-loghub-key: <key>

Service validates key against API_KEYS_JSON[source]

Endpoints (MVP)
1) Health

GET /health → { ok: true }

2) Generic log ingest (most apps should use this)

POST /ingest/log
Headers:

x-loghub-source = railway|vercel|twilio|chrome|supabase|custom

x-loghub-key = source key
Body (JSON):

{
  "service": "leadbridge-api",
  "app": "leadbridge",
  "env": "prod",
  "level": "info",
  "message": "something happened",
  "attrs": {
    "request_id": "req_123",
    "lead_id": "L_456",
    "callSid": "CA_789"
  }
}
3) Twilio event ingest (normalized wrapper)

POST /ingest/twilio
Headers: same
Body: raw Twilio webhook/event payload (JSON)
Service should:

extract correlation fields if present (callSid, messageSid, accountSid)

include source=twilio and service=twilio-webhook

log a concise message like "Twilio event received" plus normalized attributes

4) Vercel drain ingest (optional MVP)

POST /ingest/vercel
Headers: same
Body: accept arbitrary JSON (don’t assume format), store as message.

(If drains are tricky, keep this endpoint but treat payload as opaque JSON for now.)

Normalization Rules
Required OTEL resource attributes

service.name = body.service (fallback loghub)

app = body.app (fallback unknown)

env = body.env (fallback DEFAULT_ENV)

source = header x-loghub-source

level = body.level

ts = server received timestamp ISO

Optional attributes (if present)

request_id, lead_id, callSid, messageSid, user_id, phone_hash

Message body

if message is object → JSON stringify

if huge → truncate to 8KB and add attr truncated=true

PII handling (MVP)

By default (ALLOW_PII=false), sanitize:

phone numbers → hash or mask (last 2 digits)

emails → mask

Add pii_sanitized=true attribute when sanitization occurs

If ALLOW_PII=true, do not sanitize

OTLP Forwarder Implementation

Implement a provider GrafanaOtlpForwarder that builds this OTLP payload:

{
  "resourceLogs": [{
    "resource": { "attributes": [ ... ] },
    "scopeLogs": [{
      "logRecords": [{
        "timeUnixNano": "<now ns>",
        "severityText": "INFO|ERROR|WARN|DEBUG",
        "body": { "stringValue": "<message>" }
      }]
    }]
  }]
}

Send to GRAFANA_OTLP_LOGS_URL with header:

Authorization: ${GRAFANA_OTLP_AUTH}

Content-Type: application/json

Failure behavior:

Never throw to client unless auth fails

If Grafana push fails: return 202 Accepted and log locally (console) with reason

Add simple in-memory rate limit per source (basic token bucket) to protect the service

Security & Reliability
Body limits

enforce MAX_BODY_KB (default 256KB)

reject bigger payloads with 413 Payload Too Large

Auth

require x-loghub-source and x-loghub-key for all /ingest/*

return 401 if missing or invalid

Response

200 { ok: true, id: "<uuid>", forwarded: true } if Grafana push succeeded

202 { ok: true, id: "<uuid>", forwarded: false } if push failed (but accepted)

Include an id (UUID) in response and in forwarded log attrs as ingest_id.

Project Structure

src/main.ts (fastify recommended)

src/app.module.ts

src/ingest/ingest.controller.ts

src/ingest/ingest.service.ts (normalize + call forwarder)

src/otel/grafana-otlp.forwarder.ts

src/common/auth.guard.ts

src/common/pii-sanitize.ts

src/common/size-limit.middleware.ts

src/common/rate-limit.ts

Add basic unit tests for:

auth guard

sanitization

payload truncation

OTLP payload builder

Deliverables

A working NestJS app that runs locally (npm run start:dev)

Railway-ready (port from process.env.PORT)

Example curl commands for each endpoint

README with:

env vars

how to generate GRAFANA_OTLP_AUTH

example queries in Grafana Explore:

service.name="loghub"

source="twilio"

callSid="CA..."

Example curls (must be included in README)
Generic
curl -X POST "$LOGHUB_URL/ingest/log" \
  -H "Content-Type: application/json" \
  -H "x-loghub-source: railway" \
  -H "x-loghub-key: RAIlWAY_INGEST_KEY_123" \
  -d '{"service":"leadbridge-api","app":"leadbridge","env":"prod","level":"info","message":"hello","attrs":{"request_id":"req_1"}}'
Twilio
curl -X POST "$LOGHUB_URL/ingest/twilio" \
  -H "Content-Type: application/json" \
  -H "x-loghub-source: twilio" \
  -H "x-loghub-key: TWILIO_INGEST_KEY_123" \
  -d '{"CallSid":"CA123","From":"+18135551212","To":"+18135559876","CallStatus":"no-answer"}'
