/**
 * Strip credentials from text before it reaches a terminal, a log file, or an
 * error message. Provider URLs carry keys in the path (`/v2/<key>`, `/v3/<key>`)
 * or the query string, and ethers echoes request URLs inside its errors.
 */

/** Path/query segments that look like keys: 20+ chars of base64url-ish text. */
const LONG_SEGMENT = /([/=])[A-Za-z0-9_-]{20,}/g;

/** Explicitly named secret query parameters. */
const SECRET_QUERY = /([?&](?:api[-_]?key|apikey|key|token|auth|secret)=)[^&\s"']+/gi;

/** `scheme://user:password@host` */
const USERINFO = /([a-z][a-z0-9+.-]*:\/\/)[^/@\s"']+@/gi;

export const redactSecrets = (text: string): string =>
  text.replace(USERINFO, '$1***@').replace(SECRET_QUERY, '$1***').replace(LONG_SEGMENT, '$1***');
