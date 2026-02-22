import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { GrafanaOtlpForwarder } from '../otel/grafana-otlp.forwarder';
import { sanitizePii, sanitizeObject } from '../common/pii-sanitize';
import { checkRateLimit } from '../common/rate-limit';

const MAX_MESSAGE_BYTES = 8 * 1024; // 8 KB

const OPTIONAL_FIELDS = [
  'request_id',
  'lead_id',
  'callSid',
  'messageSid',
  'user_id',
  'phone_hash',
];

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(private readonly forwarder: GrafanaOtlpForwarder) {}

  private truncateMessage(msg: string): { message: string; truncated: boolean } {
    const buf = Buffer.from(msg, 'utf8');
    if (buf.length > MAX_MESSAGE_BYTES) {
      return { message: buf.slice(0, MAX_MESSAGE_BYTES).toString('utf8'), truncated: true };
    }
    return { message: msg, truncated: false };
  }

  async ingestLog(
    source: string,
    body: any,
  ): Promise<{ ok: boolean; id: string; forwarded: boolean }> {
    if (!checkRateLimit(source)) {
      throw new HttpException(
        { statusCode: 429, message: 'Too Many Requests' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const id = uuidv4();
    const allowPii = process.env.ALLOW_PII === 'true';
    const defaultEnv = process.env.DEFAULT_ENV ?? 'prod';

    // Normalize message to string
    const rawMessage =
      body.message !== null && typeof body.message === 'object'
        ? JSON.stringify(body.message)
        : String(body.message ?? '');

    const { message: truncatedMsg, truncated } = this.truncateMessage(rawMessage);

    // Sanitize message string
    let finalMessage = truncatedMsg;
    let messagePiiSanitized = false;
    if (!allowPii) {
      const { sanitized, changed } = sanitizePii(truncatedMsg);
      finalMessage = sanitized;
      messagePiiSanitized = changed;
    }

    // Sanitize attrs object
    const rawAttrs = body.attrs && typeof body.attrs === 'object' ? body.attrs : {};
    const { result: sanitizedAttrs, piiSanitized: attrsPiiSanitized } = sanitizeObject(
      rawAttrs,
      allowPii,
    );

    const piiSanitized = messagePiiSanitized || attrsPiiSanitized;

    // Build OTLP resource attributes
    const attributes: Record<string, string | boolean> = {
      'service.name': String(body.service ?? 'loghub'),
      app: String(body.app ?? 'unknown'),
      env: String(body.env ?? defaultEnv),
      source,
      level: String(body.level ?? 'info'),
      ts: new Date().toISOString(),
      ingest_id: id,
    };

    // Optional well-known fields (from attrs or top-level body)
    for (const field of OPTIONAL_FIELDS) {
      const val = sanitizedAttrs[field] ?? body[field];
      if (val !== undefined && val !== null) {
        attributes[field] = String(val);
      }
    }

    // Remaining sanitized attrs (prefixed to avoid collision)
    for (const [k, v] of Object.entries(sanitizedAttrs)) {
      if (!OPTIONAL_FIELDS.includes(k) && !(k in attributes)) {
        attributes[`attr.${k}`] = String(v);
      }
    }

    if (truncated) attributes.truncated = true;
    if (piiSanitized) attributes.pii_sanitized = true;

    const timestampNs = (BigInt(Date.now()) * 1_000_000n).toString();

    const forwarded = await this.forwarder.forward({
      message: finalMessage,
      severity: String(body.level ?? 'info'),
      attributes,
      timestampNs,
    });

    if (!forwarded) {
      this.logger.warn(`Grafana forward failed — ingest_id=${id} source=${source}`);
    }

    return { ok: true, id, forwarded };
  }

  async ingestTwilio(
    source: string,
    body: any,
  ): Promise<{ ok: boolean; id: string; forwarded: boolean }> {
    const attrs: Record<string, string> = {};

    // Extract Twilio correlation fields (handles both camel and Pascal case)
    const pick = (a: string, b: string) => body[a] ?? body[b];
    const callSid = pick('CallSid', 'callSid');
    const messageSid = pick('MessageSid', 'messageSid');
    const accountSid = pick('AccountSid', 'accountSid');
    const callStatus = pick('CallStatus', 'callStatus');
    const direction = pick('Direction', 'direction');

    if (callSid) attrs.callSid = callSid;
    if (messageSid) attrs.messageSid = messageSid;
    if (accountSid) attrs.accountSid = accountSid;
    if (callStatus) attrs.callStatus = callStatus;
    if (direction) attrs.direction = direction;

    return this.ingestLog(source, {
      service: 'twilio-webhook',
      app: 'twilio',
      env: body.env ?? process.env.DEFAULT_ENV ?? 'prod',
      level: 'info',
      message: 'Twilio event received',
      attrs,
    });
  }

  async ingestVercel(
    source: string,
    body: any,
  ): Promise<{ ok: boolean; id: string; forwarded: boolean }> {
    return this.ingestLog(source, {
      service: body.service ?? 'vercel-drain',
      app: body.app ?? 'vercel',
      env: body.env ?? process.env.DEFAULT_ENV ?? 'prod',
      level: body.level ?? 'info',
      // Treat entire body as the message (opaque JSON drain)
      message: typeof body === 'object' ? JSON.stringify(body) : String(body),
      attrs: {},
    });
  }
}
