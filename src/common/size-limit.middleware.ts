import { Injectable, NestMiddleware } from '@nestjs/common';

/**
 * Early-rejection middleware that checks the Content-Length header
 * before the body is parsed. The hard limit is also enforced by
 * Fastify's bodyLimit option set in main.ts.
 */
@Injectable()
export class SizeLimitMiddleware implements NestMiddleware {
  use(req: any, res: any, next: () => void) {
    const maxBytes = parseInt(process.env.MAX_BODY_KB ?? '256', 10) * 1024;
    const contentLength = parseInt(req.headers['content-length'] ?? '0', 10);

    if (contentLength > maxBytes) {
      const body = JSON.stringify({
        statusCode: 413,
        error: 'Payload Too Large',
        message: `Body exceeds ${process.env.MAX_BODY_KB ?? 256}KB limit`,
      });

      // Works for both Express (res.statusCode / res.end) and Fastify (res.raw)
      const raw = res.raw ?? res;
      raw.statusCode = 413;
      raw.setHeader('Content-Type', 'application/json');
      raw.end(body);
      return;
    }

    next();
  }
}
