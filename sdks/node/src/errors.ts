// Thrown for every non-2xx response from the Lastro Partner API. Carries the real HTTP
// status and the parsed error body (routes/v1.ts always responds with at least
// { error, message } on failure — Zod validation failures also include `issues`) instead
// of just a generic "request failed" message, so a caller can branch on `error` the same
// way they'd branch on an HTTP status code.
export class LastroApiError extends Error {
  readonly status: number;
  readonly error: string;
  readonly issues?: unknown;

  constructor(status: number, body: { error?: string; message?: string; issues?: unknown }) {
    super(body.message || body.error || `Lastro API request failed with status ${status}`);
    this.name = 'LastroApiError';
    this.status = status;
    this.error = body.error ?? 'unknown_error';
    this.issues = body.issues;
  }
}

// Thrown when the client can't reach the API at all (network error, DNS failure, etc.) —
// distinct from LastroApiError, which means the API was reached and responded with a
// real error. Lets a caller retry a LastroNetworkError while treating a 4xx as final.
export class LastroNetworkError extends Error {
  readonly cause: unknown;
  constructor(message: string, cause: unknown) {
    super(message);
    this.name = 'LastroNetworkError';
    this.cause = cause;
  }
}
