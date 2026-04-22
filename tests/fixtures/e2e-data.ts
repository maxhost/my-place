/**
 * Constantes compartidas entre el seed E2E, los specs Playwright y los tests RLS.
 *
 * INVARIANTES (no cambiar sin coordinación):
 *
 * 1. Emails E2E siempre matchean `/^e2e-.*@e2e\.place\.local$/`. Es el prefijo
 *    reservado para identificar fixtures de test en my-place Cloud (compartido
 *    con dev). Crear data manual con este patrón pisa el seed.
 *
 * 2. Place IDs E2E siempre empiezan con `place_e2e_`. Mismo rationale.
 *
 * 3. Los place slugs usan prefijo `e2e-` para reforzar visibilidad en URLs
 *    durante debug (ej: `http://e2e-palermo.lvh.me:3000`).
 *
 * Los user IDs NO son determinísticos: Supabase auth.users genera UUIDs al
 * crear el usuario. Los tests que necesiten el `id` lo resuelven al runtime
 * (via `SELECT id FROM "User" WHERE email = ?`). Ver `tests/rls/harness.ts`.
 */

export const E2E_EMAIL_DOMAIN = 'e2e.place.local'
export const E2E_PLACE_ID_PREFIX = 'place_e2e_'

export const E2E_ROLES = ['owner', 'admin', 'memberA', 'memberB', 'exMember', 'nonMember'] as const
export type E2ERole = (typeof E2E_ROLES)[number]

export const E2E_EMAILS: Record<E2ERole, string> = {
  owner: `e2e-owner@${E2E_EMAIL_DOMAIN}`,
  admin: `e2e-admin@${E2E_EMAIL_DOMAIN}`,
  memberA: `e2e-member-a@${E2E_EMAIL_DOMAIN}`,
  memberB: `e2e-member-b@${E2E_EMAIL_DOMAIN}`,
  exMember: `e2e-ex-member@${E2E_EMAIL_DOMAIN}`,
  nonMember: `e2e-non-member@${E2E_EMAIL_DOMAIN}`,
}

export const E2E_DISPLAY_NAMES: Record<E2ERole, string> = {
  owner: 'Owner E2E',
  admin: 'Admin E2E',
  memberA: 'Member A E2E',
  memberB: 'Member B E2E',
  exMember: 'Ex Member E2E',
  nonMember: 'Non Member E2E',
}

export type E2EPlaceKey = 'palermo' | 'belgrano'

export const E2E_PLACES: Record<E2EPlaceKey, { id: string; slug: string; name: string }> = {
  palermo: {
    id: `${E2E_PLACE_ID_PREFIX}palermo`,
    slug: 'e2e-palermo',
    name: 'Palermo E2E',
  },
  belgrano: {
    id: `${E2E_PLACE_ID_PREFIX}belgrano`,
    slug: 'e2e-belgrano',
    name: 'Belgrano E2E',
  },
}

/**
 * Slug del post baseline que el seed crea en cada place E2E. Los specs que
 * necesiten un post pre-existente pueden leerlo por este slug estable.
 */
export const E2E_BASELINE_POST_SLUG = 'e2e-baseline-post'

export const E2E_EMAIL_PATTERN = /^e2e-.*@e2e\.place\.local$/
