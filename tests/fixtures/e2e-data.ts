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

// ---------------------------------------------------------------
// PermissionGroups baseline (C.4 — plan tidy-stargazing-summit)
// ---------------------------------------------------------------

/**
 * Grupos baseline en `place_e2e_palermo`. IDs deterministas con prefijo
 * `grp_e2e_palermo_*` — todos los IDs E2E reservados por contrato (ver
 * comentario superior). Fuera de palermo NO hay groups baseline; los
 * specs mutativos crean grupos temporales con nombre único por worker
 * (patrón `tiers.spec.ts`) y limpian en `afterAll()`.
 *
 * `adminPreset`: el grupo preset auto-generado por `places/server/actions`
 * cuando se crea un place. En el seed lo creamos explícitamente con `id`
 * estable para que los tests RLS y los specs E2E puedan referenciarlo
 * sin lookup. `isPreset = true`, `permissions = PERMISSIONS_ALL`.
 *
 * `moderators`: grupo custom con permisos delegables, usado por specs
 * para verificar que un miembro fuera del preset puede ejecutar
 * acciones gateadas por permisos atómicos (`flags:review`,
 * `discussions:hide-post`).
 */
export type E2EGroupKey = 'adminPreset' | 'moderators' | 'libraryMods'

export const E2E_GROUPS: Record<
  E2EGroupKey,
  {
    id: string
    placeId: string
    name: string
    isPreset: boolean
    permissions: readonly string[]
  }
> = {
  adminPreset: {
    id: 'grp_e2e_palermo_admin_preset',
    placeId: `${E2E_PLACE_ID_PREFIX}palermo`,
    name: 'Administradores',
    isPreset: true,
    // PERMISSIONS_ALL del slice groups — copia literal para evitar coupling.
    // Si cambia el set en `groups/domain/permissions.ts`, este array se
    // actualiza con un `pnpm test:e2e:seed` que el typecheck del slice
    // groups dispara primero.
    permissions: [
      'discussions:hide-post',
      'discussions:delete-post',
      'discussions:hide-comment',
      'discussions:delete-comment',
      'flags:review',
      'events:moderate',
      'library:moderate-categories',
      'library:moderate-items',
      'members:block',
      'members:invite',
    ],
  },
  moderators: {
    id: 'grp_e2e_palermo_moderators',
    placeId: `${E2E_PLACE_ID_PREFIX}palermo`,
    name: 'Moderadores E2E',
    isPreset: false,
    permissions: ['flags:review', 'discussions:hide-post'],
  },
  // Library moderators — perms scope-able a categorías. El seed hoy no
  // crea baseline scope a categorías concretas (queda para iteración
  // futura cuando el seed extienda con LibraryCategory baseline). El
  // grupo de por sí ya sirve a los specs que solo verifican existencia
  // en la lista de grupos del place.
  libraryMods: {
    id: 'grp_e2e_palermo_library_mods',
    placeId: `${E2E_PLACE_ID_PREFIX}palermo`,
    name: 'Library Mods E2E',
    isPreset: false,
    permissions: ['library:moderate-categories', 'library:moderate-items'],
  },
}

/**
 * Memberships baseline a los `E2E_GROUPS`. La key es el role del user
 * fixture (`E2ERole`); el valor es el `E2EGroupKey` al que pertenece.
 *
 * Baseline (palermo):
 * - `owner` → `adminPreset` (creador del place hereda admin)
 * - `admin` → `adminPreset` (rol original "ADMIN" pre-cleanup)
 * - `memberA` → `moderators` (verifica que un grupo custom otorga perms)
 *
 * `memberB` (belgrano) y `nonMember` no aparecen — sin baseline. Los
 * specs mutativos pueden agregar/quitar membresías a temp groups sin
 * tocar este baseline.
 */
export const E2E_GROUP_MEMBERSHIPS: Array<{
  userRole: E2ERole
  groupKey: E2EGroupKey
}> = [
  { userRole: 'owner', groupKey: 'adminPreset' },
  { userRole: 'admin', groupKey: 'adminPreset' },
  { userRole: 'memberA', groupKey: 'moderators' },
]

// ---------------------------------------------------------------
// Library categories baseline (R.7 — slice library)
// ---------------------------------------------------------------

/**
 * Categorías baseline en `place_e2e_palermo`. IDs deterministas con prefijo
 * `cat_e2e_palermo_*` (mismo contrato de prefijos reservados que groups y
 * places). Fuera de palermo NO hay categorías baseline; los specs que
 * mutan crean temp categories con cleanup en `afterAll()`.
 *
 * Tres categorías para cubrir la matriz de policies + read access:
 *
 * - `tutorials` (MEMBERS_OPEN, GENERAL, PUBLIC): cualquier miembro activo
 *   crea items. Usada para FAB visibility happy path y edit/archive own.
 * - `resources` (DESIGNATED, GENERAL, PUBLIC): solo contributors designados
 *   crean. memberA es contributor por seed → cubre flow contributor; memberB
 *   no → cubre flow bloqueado server-side.
 * - `presetOnly` (DESIGNATED, GENERAL, PUBLIC, sin contributors): solo
 *   admin/owner crean. Reemplaza el viejo ADMIN_ONLY (post 2026-05-04 ADR)
 *   con `DESIGNATED + lista de contributors vacía`. Cubre el bloqueo de
 *   members comunes incluyendo `memberA` (que tiene designation en
 *   `resources` pero no en esta).
 *
 * `policy` es el campo Prisma `contributionPolicy`; lo aliasamos a `policy`
 * en la fixture para que los specs queden compactos (`tutorialsCat.policy`).
 */
export type E2ECategoryKey = 'tutorials' | 'resources' | 'presetOnly' | 'cookingCourse'

export const E2E_LIBRARY_CATEGORIES: Record<
  E2ECategoryKey,
  {
    id: string
    placeId: string
    slug: string
    title: string
    emoji: string
    kind: 'GENERAL' | 'COURSE'
    readAccessKind: 'PUBLIC' | 'GROUPS' | 'TIERS' | 'USERS'
    /** S1b (2026-05-13): reemplaza el legacy `policy`. */
    writeAccessKind: 'OWNER_ONLY' | 'GROUPS' | 'TIERS' | 'USERS'
    /** Roles fixture que el seed agrega al `LibraryCategoryUserWriteScope`
     *  (sólo aplica si writeAccessKind === 'USERS'). */
    writeUserRoles: readonly E2ERole[]
    /** Posición manual fija para orden estable entre runs. */
    position: number
  }
> = {
  tutorials: {
    id: 'cat_e2e_palermo_tutorials',
    placeId: `${E2E_PLACE_ID_PREFIX}palermo`,
    slug: 'tutorials',
    title: 'Tutoriales',
    emoji: '📚',
    kind: 'GENERAL',
    readAccessKind: 'PUBLIC',
    writeAccessKind: 'OWNER_ONLY',
    writeUserRoles: [],
    position: 0,
  },
  resources: {
    id: 'cat_e2e_palermo_resources',
    placeId: `${E2E_PLACE_ID_PREFIX}palermo`,
    slug: 'resources',
    title: 'Recursos',
    emoji: '🗂️',
    kind: 'GENERAL',
    readAccessKind: 'PUBLIC',
    writeAccessKind: 'USERS',
    writeUserRoles: ['memberA'],
    position: 1,
  },
  presetOnly: {
    id: 'cat_e2e_palermo_preset_only',
    placeId: `${E2E_PLACE_ID_PREFIX}palermo`,
    slug: 'preset-only',
    title: 'Restringida',
    emoji: '🔒',
    kind: 'GENERAL',
    readAccessKind: 'PUBLIC',
    writeAccessKind: 'OWNER_ONLY',
    writeUserRoles: [],
    position: 2,
  },
  // W5 wiring courses (2026-05-14): categoría tipo curso con cadena de
  // 3 lecciones encadenadas por prereq (A → B → C). Habilita E2E del flow
  // completo: viewer ve A abierta, B/C lockeadas → marca A → B se desbloquea.
  cookingCourse: {
    id: 'cat_e2e_palermo_cooking_course',
    placeId: `${E2E_PLACE_ID_PREFIX}palermo`,
    slug: 'cocina',
    title: 'Lecciones de cocina',
    emoji: '🍳',
    kind: 'COURSE',
    readAccessKind: 'PUBLIC',
    writeAccessKind: 'OWNER_ONLY',
    writeUserRoles: [],
    position: 3,
  },
}

// ---------------------------------------------------------------
// Library items baseline (R.7 — slice library)
// ---------------------------------------------------------------

/**
 * Items baseline en categorías de palermo. IDs deterministas con prefijo
 * `item_e2e_palermo_*` (LibraryItem) y `post_e2e_palermo_lib_*` (Post 1:1).
 *
 * - `tutorialsIntro`: item en `tutorials`, autor `admin`. Sirve como el
 *   item "del otro" para tests de viewer (memberA ve un item que NO es
 *   suyo).
 * - `resourcesDoc`: item en `resources`, autor `memberA` (que es
 *   contributor). Sirve como el item "propio" para tests de
 *   edit/archive own.
 *
 * Slug del Post se usa para URL canónica `/library/<catSlug>/<postSlug>`;
 * el spec `library-viewer-listing.spec.ts` lo lee como `postSlug`.
 */
export type E2ELibraryItemKey =
  | 'tutorialsIntro'
  | 'resourcesDoc'
  | 'cookingLessonA'
  | 'cookingLessonB'
  | 'cookingLessonC'

export const E2E_LIBRARY_ITEMS: Record<
  E2ELibraryItemKey,
  {
    id: string
    postId: string
    postSlug: string
    title: string
    placeId: string
    categoryKey: E2ECategoryKey
    authorRole: E2ERole
    /** ID del item prereq (clave de E2E_LIBRARY_ITEMS), si aplica. Solo
     *  para items en categorías kind=COURSE. */
    prereqItemKey?: E2ELibraryItemKey
  }
> = {
  tutorialsIntro: {
    id: 'item_e2e_palermo_tutorials_intro',
    postId: 'post_e2e_palermo_lib_tutorials_intro',
    postSlug: 'tutorials-intro',
    title: 'Introducción a tutoriales E2E',
    placeId: `${E2E_PLACE_ID_PREFIX}palermo`,
    categoryKey: 'tutorials',
    authorRole: 'admin',
  },
  resourcesDoc: {
    id: 'item_e2e_palermo_resources_doc',
    postId: 'post_e2e_palermo_lib_resources_doc',
    postSlug: 'resources-doc',
    title: 'Documento de recursos E2E',
    placeId: `${E2E_PLACE_ID_PREFIX}palermo`,
    categoryKey: 'resources',
    authorRole: 'memberA',
  },
  // W5 wiring courses: cadena A → B → C en cookingCourse. A no tiene
  // prereq (siempre abierto), B requiere A, C requiere B.
  cookingLessonA: {
    id: 'item_e2e_palermo_cooking_lesson_a',
    postId: 'post_e2e_palermo_lib_cooking_a',
    postSlug: 'galletas-de-chocolate',
    title: 'Galletas de chocolate',
    placeId: `${E2E_PLACE_ID_PREFIX}palermo`,
    categoryKey: 'cookingCourse',
    authorRole: 'admin',
  },
  cookingLessonB: {
    id: 'item_e2e_palermo_cooking_lesson_b',
    postId: 'post_e2e_palermo_lib_cooking_b',
    postSlug: 'postres-cheesecake',
    title: 'Postres cheesecake',
    placeId: `${E2E_PLACE_ID_PREFIX}palermo`,
    categoryKey: 'cookingCourse',
    authorRole: 'admin',
    prereqItemKey: 'cookingLessonA',
  },
  cookingLessonC: {
    id: 'item_e2e_palermo_cooking_lesson_c',
    postId: 'post_e2e_palermo_lib_cooking_c',
    postSlug: 'reposteria-francesa',
    title: 'Repostería francesa',
    placeId: `${E2E_PLACE_ID_PREFIX}palermo`,
    categoryKey: 'cookingCourse',
    authorRole: 'admin',
    prereqItemKey: 'cookingLessonB',
  },
}

// ---------------------------------------------------------------
// Tiers baseline (T.4 — slice tiers)
// ---------------------------------------------------------------

/**
 * Tiers baseline en `place_e2e_palermo`. IDs deterministas con prefijo
 * `tier_e2e_palermo_*` (mismo contrato que el resto de fixtures).
 *
 * - `colaboradores`: free (priceCents 0) + PUBLISHED. Usado por
 *   `members-directory.spec.ts` (assign/remove sobre memberA) y por
 *   `tiers.spec.ts` para verificar listado read-only del owner.
 * - `premium`: paid (priceCents 999 → "9,99") + HIDDEN. Cubre el copy
 *   de precio formateado en `tiers.spec.ts`.
 *
 * `duration` arranca en `ONE_MONTH` por default (campo obligatorio del
 * schema; los specs no lo testean explícitamente). `currency` queda en
 * USD (default del schema).
 */
export type E2ETierKey = 'colaboradores' | 'premium'

export const E2E_TIERS: Record<
  E2ETierKey,
  {
    id: string
    placeId: string
    name: string
    priceCents: number
    duration:
      | 'SEVEN_DAYS'
      | 'FIFTEEN_DAYS'
      | 'ONE_MONTH'
      | 'THREE_MONTHS'
      | 'SIX_MONTHS'
      | 'ONE_YEAR'
    visibility: 'PUBLISHED' | 'HIDDEN'
  }
> = {
  colaboradores: {
    id: 'tier_e2e_palermo_colaboradores',
    placeId: `${E2E_PLACE_ID_PREFIX}palermo`,
    name: 'Colaboradores',
    priceCents: 0,
    duration: 'ONE_MONTH',
    visibility: 'PUBLISHED',
  },
  premium: {
    id: 'tier_e2e_palermo_premium',
    placeId: `${E2E_PLACE_ID_PREFIX}palermo`,
    name: 'Premium',
    priceCents: 999,
    duration: 'ONE_MONTH',
    visibility: 'HIDDEN',
  },
}
