/**
 * The error envelope from Boundary C section 1. The code set is part of the published
 * contract: adding one needs a CHANGED row in docs/stacks/BACKEND_TO_FRONTEND.md.
 */
export const ERROR_CODES = [
  'ASSET_NOT_FOUND',
  'INDEXER_BEHIND',
  'MOCK_DISABLED',
  'CHAIN_UNAVAILABLE',
  'BAD_REQUEST',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  ASSET_NOT_FOUND: 404,
  INDEXER_BEHIND: 503,
  MOCK_DISABLED: 503,
  CHAIN_UNAVAILABLE: 503,
  BAD_REQUEST: 400,
  INTERNAL: 500,
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code];
    this.details = details;
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError('BAD_REQUEST', message, details);
  }

  static notFound(message: string): ApiError {
    return new ApiError('ASSET_NOT_FOUND', message);
  }

  static internal(message: string, details?: unknown): ApiError {
    return new ApiError('INTERNAL', message, details);
  }
}

/**
 * Thrown before the server ever listens. Every one of these means the process would
 * otherwise index the wrong chain, the wrong deployment, or an unvalidated configuration.
 */
export class StartupError extends Error {
  readonly hint: string | undefined;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'StartupError';
    this.hint = hint;
  }
}
