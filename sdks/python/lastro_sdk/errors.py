"""Real error types for the Lastro Partner API client — mirrors sdks/node/src/errors.ts."""

from typing import Any, Optional


class LastroApiError(Exception):
    """Raised for every non-2xx response the API actually returned.

    routes/v1.ts always responds with at least {"error": ..., "message": ...} on
    failure (Zod validation failures also include "issues") — this carries the real
    HTTP status and parsed body instead of just a generic "request failed" message,
    so callers can branch on `.error` the same way they'd branch on a status code.
    """

    def __init__(self, status: int, body: dict):
        self.status = status
        self.error = body.get("error", "unknown_error")
        self.issues: Optional[Any] = body.get("issues")
        message = body.get("message") or body.get("error") or f"Lastro API request failed with status {status}"
        super().__init__(message)


class LastroNetworkError(Exception):
    """Raised when the client can't reach the API at all (DNS/connection/timeout).

    Distinct from LastroApiError, which means the API was reached and responded
    with a real error — lets a caller retry a LastroNetworkError while treating a
    LastroApiError as final.
    """

    def __init__(self, message: str, cause: BaseException):
        self.cause = cause
        super().__init__(message)
