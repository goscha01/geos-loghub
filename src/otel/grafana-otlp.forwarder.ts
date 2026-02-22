import { Injectable, Logger } from '@nestjs/common';

interface OtlpAttribute {
  key: string;
  value: { stringValue?: string; boolValue?: boolean };
}

export interface NormalizedLog {
  message: string;
  severity: string;
  attributes: Record<string, string | boolean>;
  timestampNs: string;
}

function toOtlpAttributes(attrs: Record<string, string | boolean>): OtlpAttribute[] {
  return Object.entries(attrs).map(([key, value]) => ({
    key,
    value:
      typeof value === 'boolean'
        ? { boolValue: value }
        : { stringValue: String(value) },
  }));
}

@Injectable()
export class GrafanaOtlpForwarder {
  private readonly logger = new Logger(GrafanaOtlpForwarder.name);

  /**
   * Builds an OTLP JSON payload and POSTs it to Grafana Cloud.
   * Returns true on success, false on any failure (never throws to caller).
   */
  async forward(log: NormalizedLog): Promise<boolean> {
    const url = process.env.GRAFANA_OTLP_LOGS_URL;
    const auth = process.env.GRAFANA_OTLP_AUTH;

    if (!url || !auth) {
      this.logger.warn('Grafana OTLP not configured — skipping forward');
      return false;
    }

    const payload = {
      resourceLogs: [
        {
          resource: {
            attributes: toOtlpAttributes(log.attributes),
          },
          scopeLogs: [
            {
              logRecords: [
                {
                  timeUnixNano: log.timestampNs,
                  severityText: log.severity.toUpperCase(),
                  body: { stringValue: log.message },
                },
              ],
            },
          ],
        },
      ],
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: auth,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text();
        this.logger.warn(`Grafana push failed: ${response.status} — ${text}`);
        return false;
      }

      return true;
    } catch (err) {
      this.logger.warn(`Grafana push error: ${(err as Error).message}`);
      return false;
    }
  }
}
