import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    // Accept auth via headers (primary) or query params (for services like Twilio that can't set headers)
    const source: string = request.headers['x-loghub-source'] ?? request.query['source'];
    const key: string = request.headers['x-loghub-key'] ?? request.query['key'];

    if (!source || !key) {
      throw new UnauthorizedException(
        'Missing x-loghub-source or x-loghub-key header',
      );
    }

    let apiKeys: Record<string, string>;
    try {
      apiKeys = JSON.parse(process.env.API_KEYS_JSON ?? '{}');
    } catch {
      throw new UnauthorizedException('Server API key configuration is invalid');
    }

    const expectedKey = apiKeys[source];
    if (!expectedKey || expectedKey !== key) {
      throw new UnauthorizedException('Invalid key for source');
    }

    return true;
  }
}
