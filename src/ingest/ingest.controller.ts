import {
  Controller,
  Post,
  Get,
  Headers,
  Body,
  UseGuards,
  Res,
  Req,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { IngestService } from './ingest.service';
import { AuthGuard } from '../common/auth.guard';

@Controller()
export class IngestController {
  constructor(private readonly ingestService: IngestService) {}

  @Get('health')
  health() {
    return { ok: true };
  }

  @Post('ingest/log')
  @UseGuards(AuthGuard)
  async ingestLog(
    @Headers('x-loghub-source') source: string,
    @Body() body: any,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const result = await this.ingestService.ingestLog(source, body);
    res.code(result.forwarded ? 200 : 202);
    return result;
  }

  @Post('ingest/twilio')
  @UseGuards(AuthGuard)
  async ingestTwilio(
    @Headers('x-loghub-source') sourceHeader: string,
    @Body() body: any,
    @Res({ passthrough: true }) res: FastifyReply,
    @Req() req: any,
  ) {
    const source = sourceHeader ?? req.query['source'] ?? 'twilio';
    const result = await this.ingestService.ingestTwilio(source, body);
    res.code(result.forwarded ? 200 : 202);
    return result;
  }

  @Post('ingest/vercel')
  @UseGuards(AuthGuard)
  async ingestVercel(
    @Headers('x-loghub-source') source: string,
    @Body() body: any,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const result = await this.ingestService.ingestVercel(source, body);
    res.code(result.forwarded ? 200 : 202);
    return result;
  }
}
