import { logger } from './logger'

export const REQUEST_ID_HEADER = 'x-request-id'

export function generateRequestId(): string {
  return globalThis.crypto.randomUUID()
}

export function getOrCreateRequestId(headers: Headers): string {
  const existing = headers.get(REQUEST_ID_HEADER)
  if (existing && isSafeRequestId(existing)) return existing
  return generateRequestId()
}

export function createRequestLogger(requestId: string) {
  return logger.child({ requestId })
}

const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/

function isSafeRequestId(value: string): boolean {
  return SAFE_REQUEST_ID.test(value)
}
