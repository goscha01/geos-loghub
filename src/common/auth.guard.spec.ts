import { UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from './auth.guard';

const makeCtx = (headers: Record<string, string>) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  }) as any;

describe('AuthGuard', () => {
  let guard: AuthGuard;

  beforeEach(() => {
    guard = new AuthGuard();
    process.env.API_KEYS_JSON = JSON.stringify({
      railway: 'RAILWAY_KEY_123',
      twilio: 'TWILIO_KEY_123',
    });
  });

  it('allows a request with a valid source and matching key', () => {
    const ctx = makeCtx({
      'x-loghub-source': 'railway',
      'x-loghub-key': 'RAILWAY_KEY_123',
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws 401 when x-loghub-source header is missing', () => {
    const ctx = makeCtx({ 'x-loghub-key': 'RAILWAY_KEY_123' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws 401 when x-loghub-key header is missing', () => {
    const ctx = makeCtx({ 'x-loghub-source': 'railway' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws 401 for a wrong key', () => {
    const ctx = makeCtx({
      'x-loghub-source': 'railway',
      'x-loghub-key': 'WRONG_KEY',
    });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws 401 for an unknown source', () => {
    const ctx = makeCtx({
      'x-loghub-source': 'unknown-source',
      'x-loghub-key': 'ANY_KEY',
    });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws 401 when API_KEYS_JSON is invalid JSON', () => {
    process.env.API_KEYS_JSON = 'not-json';
    const ctx = makeCtx({
      'x-loghub-source': 'railway',
      'x-loghub-key': 'RAILWAY_KEY_123',
    });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});
