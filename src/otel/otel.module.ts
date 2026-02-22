import { Module } from '@nestjs/common';
import { GrafanaOtlpForwarder } from './grafana-otlp.forwarder';

@Module({
  providers: [GrafanaOtlpForwarder],
  exports: [GrafanaOtlpForwarder],
})
export class OtelModule {}
