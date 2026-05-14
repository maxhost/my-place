#!/usr/bin/env tsx
/**
 * E2E seed — corre DIRECTO sobre el DB apuntado por `.env.local`.
 * Hoy: my-place Cloud (pdifweaajellxzdpbaht). En CI: branch efímera del mismo proyecto.
 *
 * Contrato no-negociable:
 *   - SÓLO toca emails `/^e2e-.*@e2e\.place\.local$/` y place IDs `/^place_e2e_/`.
 *   - NUNCA borra, trunca ni modifica entidades sin esos prefijos.
 *   - Idempotente: correr N veces produce el mismo estado.
 *
 * Scaffolding-only: este script importa `@/db/client` y el SDK admin de Supabase
 * bypasseando la app layer. No es código de aplicación. No reusar patrones de acá
 * en el resto del slice.
 *
 * Uso: `pnpm test:e2e:seed`
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { BillingMode, PlaceOpeningSource, PrismaClient } from '@prisma/client'
import type { Prisma } from '@prisma/client'

import {
  E2E_BASELINE_POST_SLUG,
  E2E_DISPLAY_NAMES,
  E2E_EMAILS,
  E2E_GROUP_MEMBERSHIPS,
  E2E_GROUPS,
  E2E_LIBRARY_CATEGORIES,
  E2E_LIBRARY_ITEMS,
  E2E_PLACES,
  E2E_ROLES,
  E2E_TIERS,
  type E2ERole,
} from './e2e-data'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    '[e2e-seed] Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY. ' +
      'Correr vía `pnpm test:e2e:seed` que carga .env.local.',
  )
  process.exit(1)
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const prisma = new PrismaClient()

async function ensureAuthUser(email: string): Promise<string> {
  const { data: listData, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })
  if (listErr) throw new Error(`listUsers failed: ${listErr.message}`)
  const found = listData.users.find((u) => u.email === email)
  if (found) return found.id

  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
  })
  if (createErr || !created?.user) {
    throw new Error(`createUser(${email}) failed: ${createErr?.message ?? 'unknown'}`)
  }
  return created.user.id
}

async function wipeE2EContent(placeIds: string[]): Promise<void> {
  await prisma.flag.deleteMany({ where: { placeId: { in: placeIds } } })
  await prisma.reaction.deleteMany({ where: { placeId: { in: placeIds } } })
  await prisma.postRead.deleteMany({
    where: { post: { placeId: { in: placeIds } } },
  })
  await prisma.comment.deleteMany({ where: { placeId: { in: placeIds } } })
  // Library: completions y items cascadean por Post (FK Cascade), pero los
  // borramos explícito para defendernos de items huérfanos creados por specs
  // que dejaron Post manual sin pasar por la action. Orden FK-safe:
  // completion → item → contributor → readScopes → category. Los read
  // scopes y contributors cascadean del category; quedan listados acá
  // como `defensive deleteMany` para corridas donde la FK Cascade no
  // limpió por algún motivo (ej: state inconsistente entre runs).
  await prisma.libraryItemCompletion.deleteMany({
    where: { item: { placeId: { in: placeIds } } },
  })
  await prisma.libraryItem.deleteMany({ where: { placeId: { in: placeIds } } })
  await prisma.libraryCategoryGroupReadScope.deleteMany({
    where: { category: { placeId: { in: placeIds } } },
  })
  await prisma.libraryCategoryTierReadScope.deleteMany({
    where: { category: { placeId: { in: placeIds } } },
  })
  await prisma.libraryCategoryUserReadScope.deleteMany({
    where: { category: { placeId: { in: placeIds } } },
  })
  // S1b: write scope pivots cascadean al borrar category — defensivo.
  await prisma.libraryCategoryGroupWriteScope.deleteMany({
    where: { category: { placeId: { in: placeIds } } },
  })
  await prisma.libraryCategoryTierWriteScope.deleteMany({
    where: { category: { placeId: { in: placeIds } } },
  })
  await prisma.libraryCategoryUserWriteScope.deleteMany({
    where: { category: { placeId: { in: placeIds } } },
  })
  await prisma.post.deleteMany({ where: { placeId: { in: placeIds } } })
  // Library categories ya sin items (Restrict de LibraryItem.categoryId
  // satisfecho). Cascadea readScopes/writeScopes.
  await prisma.libraryCategory.deleteMany({ where: { placeId: { in: placeIds } } })
  await prisma.placeOpening.deleteMany({ where: { placeId: { in: placeIds } } })
  await prisma.invitation.deleteMany({ where: { placeId: { in: placeIds } } })
  // Groups: orden FK-safe (memberships → groups). El delete de
  // `permissionGroup` cubre tanto los baseline (con id estable) como
  // cualquier temp group que un spec mutativo haya dejado huérfano por
  // un afterAll que falló — defensivo.
  await prisma.groupMembership.deleteMany({ where: { placeId: { in: placeIds } } })
  await prisma.permissionGroup.deleteMany({ where: { placeId: { in: placeIds } } })
  // Tiers: tierMembership Restrict desde Tier → borrar memberships antes
  // del tier. Membership del User al Place se borra después (membership
  // table es independiente de tierMembership).
  await prisma.tierMembership.deleteMany({ where: { placeId: { in: placeIds } } })
  await prisma.tier.deleteMany({ where: { placeId: { in: placeIds } } })
  await prisma.membership.deleteMany({ where: { placeId: { in: placeIds } } })
  await prisma.placeOwnership.deleteMany({ where: { placeId: { in: placeIds } } })
}

function baselineBody(text: string): Prisma.InputJsonValue {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  }
}

async function main(): Promise<void> {
  console.log('[e2e-seed] target:', SUPABASE_URL)

  const userIds = {} as Record<E2ERole, string>
  for (const role of E2E_ROLES) {
    const email = E2E_EMAILS[role]
    const authId = await ensureAuthUser(email)
    userIds[role] = authId
    await prisma.user.upsert({
      where: { id: authId },
      create: {
        id: authId,
        email,
        displayName: E2E_DISPLAY_NAMES[role],
        handle: `e2e-${role}`.toLowerCase(),
      },
      update: {
        email,
        displayName: E2E_DISPLAY_NAMES[role],
        handle: `e2e-${role}`.toLowerCase(),
      },
    })
    console.log(`[e2e-seed] user ${role} (${email}) → ${authId}`)
  }

  const placeIds: string[] = []
  for (const key of Object.keys(E2E_PLACES) as Array<keyof typeof E2E_PLACES>) {
    const p = E2E_PLACES[key]
    placeIds.push(p.id)
    const openingHours = {
      kind: 'always_open',
      timezone: 'America/Argentina/Buenos_Aires',
    }
    await prisma.place.upsert({
      where: { id: p.id },
      create: {
        id: p.id,
        slug: p.slug,
        name: p.name,
        description: `Place E2E (${key}) — fixture de tests. No modificar manualmente.`,
        billingMode: BillingMode.OWNER_PAYS,
        openingHours,
      },
      update: { slug: p.slug, name: p.name, openingHours },
    })
    console.log(`[e2e-seed] place ${key} (${p.slug}) → ${p.id}`)
  }

  await wipeE2EContent(placeIds)
  console.log('[e2e-seed] wiped dependent E2E content')

  const palermoId = E2E_PLACES.palermo.id
  const belgranoId = E2E_PLACES.belgrano.id

  await prisma.placeOwnership.create({
    data: { userId: userIds.owner, placeId: palermoId },
  })
  await prisma.placeOwnership.create({
    data: { userId: userIds.owner, placeId: belgranoId },
  })

  await prisma.membership.createMany({
    data: [
      { userId: userIds.owner, placeId: palermoId },
      { userId: userIds.owner, placeId: belgranoId },
      { userId: userIds.admin, placeId: palermoId },
      { userId: userIds.memberA, placeId: palermoId },
      { userId: userIds.memberB, placeId: belgranoId },
      {
        userId: userIds.exMember,
        placeId: palermoId,
        leftAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    ],
  })

  // Groups baseline (palermo). Wipe ya borró todos los groups de los placeIds
  // E2E al inicio, así que estos creates parten de un estado limpio (idempotente
  // a nivel run completo del seed). IDs deterministas con prefijo `grp_e2e_*`.
  for (const groupKey of Object.keys(E2E_GROUPS) as Array<keyof typeof E2E_GROUPS>) {
    const g = E2E_GROUPS[groupKey]
    await prisma.permissionGroup.create({
      data: {
        id: g.id,
        placeId: g.placeId,
        name: g.name,
        isPreset: g.isPreset,
        permissions: [...g.permissions],
      },
    })
    console.log(`[e2e-seed] group ${groupKey} (${g.name}) → ${g.id}`)
  }
  for (const gm of E2E_GROUP_MEMBERSHIPS) {
    const group = E2E_GROUPS[gm.groupKey]
    await prisma.groupMembership.create({
      data: {
        userId: userIds[gm.userRole],
        placeId: group.placeId,
        groupId: group.id,
      },
    })
  }
  console.log(`[e2e-seed] group memberships → ${E2E_GROUP_MEMBERSHIPS.length} rows`)

  const openingStart = new Date(Date.now() - 24 * 60 * 60 * 1000)
  for (const placeId of placeIds) {
    await prisma.placeOpening.create({
      data: {
        placeId,
        startAt: openingStart,
        source: PlaceOpeningSource.ALWAYS_OPEN,
      },
    })
  }

  await prisma.post.create({
    data: {
      placeId: palermoId,
      authorUserId: userIds.memberA,
      authorSnapshot: {
        displayName: E2E_DISPLAY_NAMES.memberA,
        avatarUrl: null,
      },
      title: 'Post baseline Palermo',
      slug: E2E_BASELINE_POST_SLUG,
      body: baselineBody('Baseline post en Palermo E2E.'),
    },
  })
  await prisma.post.create({
    data: {
      placeId: belgranoId,
      authorUserId: userIds.memberB,
      authorSnapshot: {
        displayName: E2E_DISPLAY_NAMES.memberB,
        avatarUrl: null,
      },
      title: 'Post baseline Belgrano',
      slug: E2E_BASELINE_POST_SLUG,
      body: baselineBody('Baseline post en Belgrano E2E.'),
    },
  })

  // -------------------------------------------------------------
  // Tiers baseline (palermo). Wipe ya borró todos los tiers de los
  // placeIds E2E al inicio, así que los creates parten de un estado
  // limpio (idempotente a nivel run completo del seed).
  // -------------------------------------------------------------
  for (const tierKey of Object.keys(E2E_TIERS) as Array<keyof typeof E2E_TIERS>) {
    const t = E2E_TIERS[tierKey]
    await prisma.tier.create({
      data: {
        id: t.id,
        placeId: t.placeId,
        name: t.name,
        priceCents: t.priceCents,
        duration: t.duration,
        visibility: t.visibility,
      },
    })
    console.log(`[e2e-seed] tier ${tierKey} (${t.name}) → ${t.id}`)
  }

  // -------------------------------------------------------------
  // Library categories baseline (palermo). Idem tiers: wipe limpia
  // todo, los creates corren sobre estado vacío.
  // -------------------------------------------------------------
  for (const catKey of Object.keys(E2E_LIBRARY_CATEGORIES) as Array<
    keyof typeof E2E_LIBRARY_CATEGORIES
  >) {
    const c = E2E_LIBRARY_CATEGORIES[catKey]
    await prisma.libraryCategory.create({
      data: {
        id: c.id,
        placeId: c.placeId,
        slug: c.slug,
        title: c.title,
        emoji: c.emoji,
        position: c.position,
        kind: c.kind,
        readAccessKind: c.readAccessKind,
        writeAccessKind: c.writeAccessKind,
      },
    })
    // S1b: write scope USERS pivot — si la fixture declara usuarios con
    // permiso de escritura (reemplaza al legacy "designated contributors").
    for (const role of c.writeUserRoles) {
      await prisma.libraryCategoryUserWriteScope.create({
        data: {
          categoryId: c.id,
          userId: userIds[role],
        },
      })
    }
    console.log(
      `[e2e-seed] library category ${catKey} (${c.slug}) → ${c.id} ` +
        `writeUsers=${c.writeUserRoles.length}`,
    )
  }

  // -------------------------------------------------------------
  // Library items baseline (palermo). Cada item necesita un Post 1:1
  // (FK unique). Creamos Post + LibraryItem en par, ambos con IDs
  // deterministas y placeId/authorUserId consistentes (invariante del
  // slice library).
  // -------------------------------------------------------------
  for (const itemKey of Object.keys(E2E_LIBRARY_ITEMS) as Array<keyof typeof E2E_LIBRARY_ITEMS>) {
    const it = E2E_LIBRARY_ITEMS[itemKey]
    const cat = E2E_LIBRARY_CATEGORIES[it.categoryKey]
    const authorUserId = userIds[it.authorRole]
    const authorDisplayName = E2E_DISPLAY_NAMES[it.authorRole]
    const authorSnapshot = { displayName: authorDisplayName, avatarUrl: null }

    await prisma.post.create({
      data: {
        id: it.postId,
        placeId: it.placeId,
        authorUserId,
        authorSnapshot,
        title: it.title,
        slug: it.postSlug,
        body: baselineBody(`${it.title} — baseline E2E.`),
      },
    })
    // prereqItemId: si está definido en el fixture, lo resolvemos al ID
    // del item correspondiente. Asume orden de iteración consistente — los
    // items que son prereq deben aparecer ANTES en E2E_LIBRARY_ITEMS que
    // los que los referencian (cookingLessonA antes que B antes que C).
    const prereqItemId =
      it.prereqItemKey !== undefined ? E2E_LIBRARY_ITEMS[it.prereqItemKey].id : null
    await prisma.libraryItem.create({
      data: {
        id: it.id,
        placeId: it.placeId,
        categoryId: cat.id,
        postId: it.postId,
        authorUserId,
        authorSnapshot,
        prereqItemId,
      },
    })
    console.log(`[e2e-seed] library item ${itemKey} (${it.postSlug}) → ${it.id}`)
  }

  console.log('[e2e-seed] done:', {
    users: userIds,
    places: Object.fromEntries(Object.entries(E2E_PLACES).map(([k, v]) => [k, v.id])),
  })
  void __dirname
}

main()
  .catch((err) => {
    console.error('[e2e-seed] FAILED:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
