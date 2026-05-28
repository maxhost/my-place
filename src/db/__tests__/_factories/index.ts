import type { RlsTx } from "../db-test-pool";

// Factories compartidas para tests de DB (integration + RLS) bajo
// `src/db/__tests__/`. Proof-of-pattern Phase 1.C (tech-debt-pre-v1.3, sesión
// 1.C, 2026-05-28): elimina la duplicación del `APP_USER`/`PLACE`/seed-scenario
// que aparece literal en ≥7 tests del slice members/invitations. La intención
// V1 es cubrir el seed-as-owner (admin role bypass via `tx.seed`); el assert
// sigue corriendo bajo `app_system` con el patrón canónico de
// `db-test-pool.ts` (ROLLBACK siempre, set_config claims transaction-local).
//
// ## Contract
//
// Todas las factories reciben `RlsTx` como primer arg y opcionales en el
// segundo. NO setean claims ni cambian rol — el caller orquesta `tx.as(...)`
// alrededor (las factories sólo siembran). Cada factory genera defaults
// determinísticos a partir de un counter monotónico interno (suficiente para
// que tests dentro de una misma tx no colisionen UNIQUE constraints), pero
// acepta overrides cuando el test necesita un valor específico (e.g. emails
// matching una invitation).
//
// ## ¿Por qué `app_user` directo y NO `neon_auth.user`?
//
// El runtime de tests inyecta el claim `sub` con `set_config('request.jwt.
// claims', …, true)` — el JWKS round-trip real está stubbeado por el harness.
// Por eso `makeUser` siembra sólo `app_user` con un `auth_user_id` opaco
// (string arbitrario), igual que el patrón pre-1.C en los tests originales.
// Si V1.1+ un test necesita el row real de `neon_auth.user`, factory dedicada
// se agrega entonces (no antes, evita acoplar todos los tests a un schema que
// no usan).

let counter = 0;

function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter}`;
}

export interface MadeUser {
  userId: string;
  authUserId: string;
  email: string;
  handle: string;
}

export async function makeUser(
  tx: RlsTx,
  overrides: Partial<MadeUser> & { displayName?: string } = {},
): Promise<MadeUser> {
  const authUserId = overrides.authUserId ?? nextId("auth");
  const email = overrides.email ?? `${authUserId}@x.com`;
  const handle = overrides.handle ?? `h_${authUserId}`;
  const displayName = overrides.displayName ?? authUserId.toUpperCase();
  const [{ id }] = (await tx.seed(
    `INSERT INTO app_user (auth_user_id, email, display_name, handle)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [authUserId, email, displayName, handle],
  )) as Array<{ id: string }>;
  return { userId: id, authUserId, email, handle };
}

export interface MadePlace {
  placeId: string;
  slug: string;
  founderUserId: string;
}

// Crea `place` + (por default) el row de `place_ownership` del founder. El
// runtime productivo crea ambos atómicamente vía `app.create_place`; acá los
// separamos para que el test pueda OPTAR por `ownerSeed: false` si quiere
// probar el estado "place sin owner" (raro V1, pero ahí queda la perilla).
export async function makePlace(
  tx: RlsTx,
  opts: {
    founderUserId: string;
    slug?: string;
    name?: string;
    billingMode?: "OWNER_PAYS" | "MEMBERS_PAY";
    ownerSeed?: boolean;
  },
): Promise<MadePlace> {
  const slug = opts.slug ?? nextId("place").replace(/_/g, "-");
  const name = opts.name ?? `Place ${slug}`;
  const billingMode = opts.billingMode ?? "OWNER_PAYS";
  const [{ id: placeId }] = (await tx.seed(
    `INSERT INTO place (slug, name, billing_mode, founder_user_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [slug, name, billingMode, opts.founderUserId],
  )) as Array<{ id: string }>;
  if (opts.ownerSeed !== false) {
    await tx.seed(
      `INSERT INTO place_ownership (user_id, place_id) VALUES ($1, $2)`,
      [opts.founderUserId, placeId],
    );
  }
  return { placeId, slug, founderUserId: opts.founderUserId };
}

// Co-owner / additional owner — añade place_ownership row sin tocar place.
export async function makeOwnership(
  tx: RlsTx,
  opts: { userId: string; placeId: string },
): Promise<void> {
  await tx.seed(
    `INSERT INTO place_ownership (user_id, place_id) VALUES ($1, $2)`,
    [opts.userId, opts.placeId],
  );
}

// Membership active por default. Para sembrar ex-miembro: `leftAt: new Date()`
// (o cualquier timestamp pasado). El schema acepta NULL natural → activo.
export async function makeMembership(
  tx: RlsTx,
  opts: { userId: string; placeId: string; leftAt?: Date | string | null },
): Promise<void> {
  if (opts.leftAt !== undefined && opts.leftAt !== null) {
    await tx.seed(
      `INSERT INTO membership (user_id, place_id, left_at) VALUES ($1, $2, $3)`,
      [opts.userId, opts.placeId, opts.leftAt],
    );
    return;
  }
  await tx.seed(
    `INSERT INTO membership (user_id, place_id) VALUES ($1, $2)`,
    [opts.userId, opts.placeId],
  );
}

export interface MadeInvitation {
  invitationId: string;
  token: string;
}

export async function makeInvitation(
  tx: RlsTx,
  opts: {
    placeId: string;
    email: string;
    invitedByUserId: string;
    expiresInDays?: number;
    acceptedAt?: Date | string | null;
  },
): Promise<MadeInvitation> {
  const expiresInDays = opts.expiresInDays ?? 7;
  const acceptedAt = opts.acceptedAt ?? null;
  // Token determinístico-by-counter (suficiente entropía para no colisionar
  // el UNIQUE dentro de una tx) + 64-char para encajar con el contract del
  // slot productivo (zod min(32) max(256)).
  counter += 1;
  const token = `tok_${counter}_`.padEnd(64, "0");
  const [{ id }] = (await tx.seed(
    `INSERT INTO invitation (place_id, email, invited_by, expires_at, accepted_at, token)
     VALUES ($1, $2, $3, now() + ($4 || ' days')::interval, $5, $6) RETURNING id`,
    [opts.placeId, opts.email, opts.invitedByUserId, String(expiresInDays), acceptedAt, token],
  )) as Array<{ id: string }>;
  return { invitationId: id, token };
}

// SAVEPOINT-based error capture: duplicado literal en 7 tests pre-1.C
// (create-invitation, revoke-invitation, remove-member, revoke-ownership,
// elevate-to-owner, update-my-headline, transfer-founder-ownership). Extraído
// acá para que el slot canónico viva en un solo lugar. `tx.denied()` retorna
// boolean — esto retorna code+message para asserts más precisos sobre P0001
// variants discriminadas por message.
export async function captureError(
  tx: RlsTx,
  sql: string,
  params?: unknown[],
): Promise<{ code: string | null; message: string | null }> {
  await tx.q("SAVEPOINT sp_err");
  let result: { code: string | null; message: string | null } = {
    code: null,
    message: null,
  };
  try {
    await tx.q(sql, params);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    result = { code: err.code ?? null, message: err.message ?? null };
  }
  await tx.q("ROLLBACK TO SAVEPOINT sp_err");
  await tx.q("RELEASE SAVEPOINT sp_err");
  return result;
}
