/** Fehlerklassen der Provider. retryable = Job darf wiederholt werden, permanent = nie. */
export type ProviderErrorKind = 'retryable' | 'permanent'

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind
  readonly provider: string
  readonly code?: string
  constructor(message: string, opts: { kind: ProviderErrorKind, provider: string, code?: string, cause?: unknown }) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause })
    this.name = new.target.name
    this.kind = opts.kind
    this.provider = opts.provider
    this.code = opts.code
  }

  get retryable(): boolean {
    return this.kind === 'retryable'
  }
}

export class RetryableError extends ProviderError {
  constructor(message: string, provider: string, code?: string, cause?: unknown) {
    super(message, { kind: 'retryable', provider, code, cause })
  }
}

export class PermanentError extends ProviderError {
  constructor(message: string, provider: string, code?: string, cause?: unknown) {
    super(message, { kind: 'permanent', provider, code, cause })
  }
}

/** 429: retryAfter in Sekunden (aus Retry-After). */
export class RateLimitError extends ProviderError {
  readonly retryAfter: number
  constructor(provider: string, retryAfter = 60, message = 'Rate limit erreicht') {
    super(message, { kind: 'retryable', provider, code: 'rate_limited' })
    this.retryAfter = retryAfter
  }
}

/** Token abgelaufen/widerrufen (invalid_grant, 401): nicht retrybar, Nutzer muss neu verbinden. */
export class AuthExpiredError extends ProviderError {
  constructor(provider: string, message = 'Zugang abgelaufen oder widerrufen') {
    super(message, { kind: 'permanent', provider, code: 'auth_expired' })
  }
}

/** Tages-/Kontingentlimit (z. B. YouTube quotaExceeded): Slot verschieben statt Retry-Sturm. */
export class QuotaExceededError extends ProviderError {
  constructor(provider: string, message = 'Kontingent erschöpft') {
    super(message, { kind: 'permanent', provider, code: 'quota_exceeded' })
  }
}

export function isRetryable(err: unknown): boolean {
  return err instanceof ProviderError && err.retryable
}
