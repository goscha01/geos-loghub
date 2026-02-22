import { Module } from '@nestjs/common';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';
import { OtelModule } from '../otel/otel.module';

@Module({
  imports: [OtelModule],
  controllers: [IngestController],
  providers: [IngestService],
})
export class IngestModule {}
