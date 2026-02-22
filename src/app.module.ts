import { Module, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { IngestModule } from './ingest/ingest.module';
import { SizeLimitMiddleware } from './common/size-limit.middleware';

@Module({
  imports: [IngestModule],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(SizeLimitMiddleware)
      .forRoutes({ path: 'ingest/*', method: RequestMethod.POST });
  }
}
