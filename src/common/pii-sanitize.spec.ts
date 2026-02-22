import { sanitizePii, sanitizeObject } from './pii-sanitize';

describe('sanitizePii (string)', () => {
  it('masks a US phone number and sets changed=true', () => {
    const { sanitized, changed } = sanitizePii('Call me at 813-555-1212 anytime');
    expect(changed).toBe(true);
    expect(sanitized).not.toContain('555-1212');
    expect(sanitized).toContain('12'); // last 2 digits preserved
  });

  it('masks an international phone number', () => {
    const { sanitized, changed } = sanitizePii('My number is +1 813 555 1234');
    expect(changed).toBe(true);
    expect(sanitized).not.toContain('555 1234');
  });

  it('masks an email address', () => {
    const { sanitized, changed } = sanitizePii('Contact john.doe@example.com for help');
    expect(changed).toBe(true);
    expect(sanitized).toContain('j***@example.com');
    expect(sanitized).not.toContain('john.doe');
  });

  it('returns changed=false for a plain non-PII string', () => {
    const { sanitized, changed } = sanitizePii('request_id=req_123 status=ok');
    expect(changed).toBe(false);
    expect(sanitized).toBe('request_id=req_123 status=ok');
  });

  it('handles a string with both phone and email', () => {
    const { sanitized, changed } = sanitizePii('Call 813-555-9876 or email alice@acme.com');
    expect(changed).toBe(true);
    expect(sanitized).not.toContain('555-9876');
    expect(sanitized).not.toContain('alice@acme.com');
  });
});

describe('sanitizeObject', () => {
  it('sanitizes string values containing PII', () => {
    const obj = { phone: '813-555-1212', name: 'John' };
    const { result, piiSanitized } = sanitizeObject(obj, false);
    expect(piiSanitized).toBe(true);
    expect(result.phone).not.toContain('555-1212');
    expect(result.name).toBe('John'); // not PII — unchanged
  });

  it('skips sanitization when allowPii=true', () => {
    const obj = { email: 'john@example.com', phone: '813-555-1212' };
    const { result, piiSanitized } = sanitizeObject(obj, true);
    expect(piiSanitized).toBe(false);
    expect(result.email).toBe('john@example.com');
    expect(result.phone).toBe('813-555-1212');
  });

  it('sanitizes nested objects recursively', () => {
    const obj = { user: { contact: { email: 'jane@test.com' } } };
    const { result, piiSanitized } = sanitizeObject(obj, false);
    expect(piiSanitized).toBe(true);
    expect(result.user.contact.email).toContain('***@test.com');
  });

  it('passes through non-string, non-object values unchanged', () => {
    const obj = { count: 42, active: true, data: null };
    const { result, piiSanitized } = sanitizeObject(obj, false);
    expect(piiSanitized).toBe(false);
    expect(result.count).toBe(42);
    expect(result.active).toBe(true);
    expect(result.data).toBeNull();
  });
});
