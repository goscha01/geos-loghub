import { Test, TestingModule } from '@nestjs/testing';
import { GrafanaOtlpForwarder } from './grafana-otlp.forwarder';

const SAMPLE_LOG = {
  message: 'test message',
  severity: 'info',
  attributes: { 'service.name': 'test-svc', app: 'test-app' },
  timestampNs: '1700000000000000000',
};

describe('GrafanaOtlpForwarder', () => {
  let forwarder: GrafanaOtlpForwarder;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GrafanaOtlpForwarder],
    }).compile();

    forwarder = module.get(GrafanaOtlpForwarder);

    // Reset env
    delete process.env.GRAFANA_OTLP_LOGS_URL;
    delete process.env.GRAFANA_OTLP_AUTH;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns false when GRAFANA_OTLP_LOGS_URL is not set', async () => {
    const result = await forwarder.forward(SAMPLE_LOG);
    expect(result).toBe(false);
  });

  it('returns false when GRAFANA_OTLP_AUTH is not set', async () => {
    process.env.GRAFANA_OTLP_LOGS_URL = 'http://mock/otlp/v1/logs';
    const result = await forwarder.forward(SAMPLE_LOG);
    expect(result).toBe(false);
  });

  it('builds a correct OTLP payload and returns true on success', async () => {
    process.env.GRAFANA_OTLP_LOGS_URL = 'http://mock/otlp/v1/logs';
    process.env.GRAFANA_OTLP_AUTH = 'Basic dGVzdA==';

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
    });
    global.fetch = mockFetch as any;

    const result = await forwarder.forward(SAMPLE_LOG);

    expect(result).toBe(true);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('http://mock/otlp/v1/logs');
    expect(init.headers['Authorization']).toBe('Basic dGVzdA==');

    const body = JSON.parse(init.body);
    expect(body.resourceLogs).toHaveLength(1);

    const logRecord = body.resourceLogs[0].scopeLogs[0].logRecords[0];
    expect(logRecord.body.stringValue).toBe('test message');
    expect(logRecord.severityText).toBe('INFO');
    expect(logRecord.timeUnixNano).toBe('1700000000000000000');

    const attrs: Array<{ key: string; value: any }> =
      body.resourceLogs[0].resource.attributes;
    const serviceName = attrs.find((a) => a.key === 'service.name');
    expect(serviceName?.value.stringValue).toBe('test-svc');
  });

  it('returns false and does not throw when Grafana responds with non-ok status', async () => {
    process.env.GRAFANA_OTLP_LOGS_URL = 'http://mock/otlp/v1/logs';
    process.env.GRAFANA_OTLP_AUTH = 'Basic dGVzdA==';

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    }) as any;

    await expect(forwarder.forward(SAMPLE_LOG)).resolves.toBe(false);
  });

  it('returns false and does not throw on network error', async () => {
    process.env.GRAFANA_OTLP_LOGS_URL = 'http://mock/otlp/v1/logs';
    process.env.GRAFANA_OTLP_AUTH = 'Basic dGVzdA==';

    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;

    await expect(forwarder.forward(SAMPLE_LOG)).resolves.toBe(false);
  });

  it('serializes boolean attributes with boolValue', async () => {
    process.env.GRAFANA_OTLP_LOGS_URL = 'http://mock/otlp/v1/logs';
    process.env.GRAFANA_OTLP_AUTH = 'Basic dGVzdA==';

    const mockFetch = jest.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
    global.fetch = mockFetch as any;

    await forwarder.forward({
      ...SAMPLE_LOG,
      attributes: { truncated: true, 'service.name': 'svc' },
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const attrs: Array<{ key: string; value: any }> =
      body.resourceLogs[0].resource.attributes;
    const truncatedAttr = attrs.find((a) => a.key === 'truncated');
    expect(truncatedAttr?.value.boolValue).toBe(true);
  });
});
