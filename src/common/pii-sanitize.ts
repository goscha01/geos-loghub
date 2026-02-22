// Matches common US/international phone patterns (10+ digits with separators)
const PHONE_REGEX = /(\+\d{1,3}[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/g;

// Matches standard email addresses
const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

/**
 * Sanitize a raw string value, masking phone numbers and emails.
 * Returns the sanitized string and whether any changes were made.
 */
export function sanitizePii(value: string): { sanitized: string; changed: boolean } {
  let changed = false;

  // Replace phone numbers — keep only last 2 digits
  const afterPhone = value.replace(PHONE_REGEX, (match) => {
    changed = true;
    const digits = match.replace(/\D/g, '');
    return `***${digits.slice(-2)}`;
  });

  // Replace emails — keep first char of local + domain
  const afterEmail = afterPhone.replace(EMAIL_REGEX, (match) => {
    changed = true;
    const atIdx = match.lastIndexOf('@');
    const local = match.slice(0, atIdx);
    const domain = match.slice(atIdx + 1);
    return `${local[0]}***@${domain}`;
  });

  return { sanitized: afterEmail, changed };
}

/**
 * Recursively sanitize all string values in a plain object.
 * When allowPii=true, returns the original object untouched.
 */
export function sanitizeObject(
  obj: Record<string, any>,
  allowPii: boolean,
): { result: Record<string, any>; piiSanitized: boolean } {
  if (allowPii) {
    return { result: obj, piiSanitized: false };
  }

  let piiSanitized = false;
  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      const { sanitized, changed } = sanitizePii(value);
      result[key] = sanitized;
      if (changed) piiSanitized = true;
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const { result: nested, piiSanitized: nestedChanged } = sanitizeObject(value, allowPii);
      result[key] = nested;
      if (nestedChanged) piiSanitized = true;
    } else {
      result[key] = value;
    }
  }

  return { result, piiSanitized };
}
