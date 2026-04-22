import { AuthorizationError, ConflictError, ValidationError } from './domain-error'

/** `code` inválido o ya usado en el callback de Supabase. */
export class InvalidMagicLinkError extends ValidationError {}

/** Upsert del `User` local falló después de un auth exitoso. */
export class UserSyncError extends ConflictError {}

/** Supabase devolvió 429 / over_email_send_rate_limit. */
export class MagicLinkRateLimitedError extends ValidationError {}

/** Cookie presente pero la sesión está vencida o inválida. */
export class SessionExpiredError extends AuthorizationError {}

/** Ruta protegida accedida sin sesión. Se mapea a redirect, no 401. */
export class UnauthenticatedError extends AuthorizationError {}
