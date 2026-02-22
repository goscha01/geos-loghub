import { HttpException } from '@nestjs/common';
import { IngestService } from './ingest.service';
import { GrafanaOtlpForwarder } from '../otel/grafana-otlp.forwarder';

function makeForwarder(forwarded = true): jest.Mocked<GrafanaOtlpForwarder> {
  return { forward: jest.fn().mockResolvedValue(forwarded) } as any;
}

describe('IngestService — payload truncation', () => {
  let forwarder: jest.Mocked<GrafanaOtlpForwarder>;
  let service: IngestService;

  beforeEach(() => {
    forwarder = makeForwarder();
    service = new IngestService(forwarder);
    process.env.ALLOW_PII = 'true'; // disable PII logic to keep tests focused
    process.env.DEFAULT_ENV = 'prod';
    process.env.API_KEYS_JSON = JSON.stringify({ railway: 'KEY' });
  });

  it('truncates messages larger than 8 KB and sets truncated=true', async () => {
    const hugeMessage = 'a'.repeat(9 * 1024);
    await service.ingestLog('railway', { service: 'svc', level: 'info', message: hugeMessage });

    const log = forwarder.forward.mock.calls[0][0];
    expect(Buffer.byteLength(log.message, 'utf8')).toBeLessThanOrEqual(8 * 1024);
    expect(log.attributes.truncated).toBe(true);
  });

  it('does not truncate messages under 8 KB', async () => {
    const smallMessage = 'hello world';
    await service.ingestLog('railway', { service: 'svc', level: 'info', message: smallMessage });

    const log = forwarder.forward.mock.calls[0][0];
    expect(log.message).toBe(smallMessage);
    expect(log.attributes.truncated).toBeUndefined();
  });

  it('JSON-stringifies object messages', async () => {
    const objMessage = { event: 'click', target: '#btn' };
    await service.ingestLog('railway', { service: 'svc', level: 'info', message: objMessage });

    const log = forwarder.forward.mock.calls[0][0];
    expect(typeof log.message).toBe('string');
    expect(log.message).toContain('"event"');
  });
});

describe('IngestService — response shape', () => {
  let service: IngestService;

  beforeEach(() => {
    process.env.ALLOW_PII = 'true';
    process.env.DEFAULT_ENV = 'prod';
    process.env.API_KEYS_JSON = JSON.stringify({ railway: 'KEY' });
  });

  it('returns forwarded=true when forwarder succeeds', async () => {
    service = new IngestService(makeForwarder(true));
    const result = await service.ingestLog('railway', { level: 'info', message: 'ok' });
    expect(result.ok).toBe(true);
    expect(result.forwarded).toBe(true);
    expect(result.id).toBeDefined();
  });

  it('returns forwarded=false when forwarder fails', async () => {
    service = new IngestService(makeForwarder(false));
    const result = await service.ingestLog('railway', { level: 'info', message: 'ok' });
    expect(result.ok).toBe(true);
    expect(result.forwarded).toBe(false);
  });
});

describe('IngestService — OTLP attribute mapping', () => {
  it('maps service, app, env, source, level from body and header', async () => {
    const forwarder = makeForwarder();
    const service = new IngestService(forwarder);
    process.env.ALLOW_PII = 'true';
    process.env.DEFAULT_ENV = 'staging';

    await service.ingestLog('twilio', {
      service: 'my-svc',
      app: 'my-app',
      env: 'prod',
      level: 'warn',
      message: 'hello',
    });

    const attrs = forwarder.forward.mock.calls[0][0].attributes;
    expect(attrs['service.name']).toBe('my-svc');
    expect(attrs.app).toBe('my-app');
    expect(attrs.env).toBe('prod');
    expect(attrs.source).toBe('twilio');
    expect(attrs.level).toBe('warn');
    expect(attrs.ingest_id).toBeDefined();
  });

  it('uses DEFAULT_ENV when body.env is absent', async () => {
    const forwarder = makeForwarder();
    const service = new IngestService(forwarder);
    process.env.ALLOW_PII = 'true';
    process.env.DEFAULT_ENV = 'staging';

    await service.ingestLog('railway', { level: 'info', message: 'hi' });

    const attrs = forwarder.forward.mock.calls[0][0].attributes;
    expect(attrs.env).toBe('staging');
  });
});

describe('IngestService — PII sanitization', () => {
  it('masks PII in message when ALLOW_PII=false', async () => {
    const forwarder = makeForwarder();
    const service = new IngestService(forwarder);
    process.env.ALLOW_PII = 'false';
    process.env.DEFAULT_ENV = 'prod';

    await service.ingestLog('railway', {
      level: 'info',
      message: 'user email is test@example.com',
    });

    const log = forwarder.forward.mock.calls[0][0];
    expect(log.message).not.toContain('test@example.com');
    expect(log.attributes.pii_sanitized).toBe(true);
  });
});

describe('IngestService — rate limiting', () => {
  it('throws 429 when rate limit is exceeded', async () => {
    // Override checkRateLimit via the module
    jest.resetModules();
    jest.mock('../common/rate-limit', () => ({ checkRateLimit: () => false }));

    const { IngestService: FreshService } = await import('./ingest.service');
    const svc = new FreshService(makeForwarder());
    process.env.ALLOW_PII = 'true';
    process.env.DEFAULT_ENV = 'prod';

    await expect(
      svc.ingestLog('railway', { level: 'info', message: 'hi' }),
    ).rejects.toThrow(HttpException);

    jest.resetModules();
  });
});
