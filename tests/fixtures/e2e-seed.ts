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
import { BillingMode, MembershipRole, PlaceOpeningSource, PrismaClient } from '@prisma/client'
import type { Prisma } from '@prisma/client'

import {
  E2E_BASELINE_POST_SLUG,
  E2E_DISPLAY_NAMES,
  E2E_EMAILS,
  E2E_PLACES,
  E2E_ROLES,
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
  await prisma.post.deleteMany({ where: { placeId: { in: placeIds } } })
  await prisma.placeOpening.deleteMany({ where: { placeId: { in: placeIds } } })
  await prisma.invitation.deleteMany({ where: { placeId: { in: placeIds } } })
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
      { userId: userIds.owner, placeId: palermoId, role: MembershipRole.ADMIN },
      { userId: userIds.owner, placeId: belgranoId, role: MembershipRole.ADMIN },
      { userId: userIds.admin, placeId: palermoId, role: MembershipRole.ADMIN },
      { userId: userIds.memberA, placeId: palermoId, role: MembershipRole.MEMBER },
      { userId: userIds.memberB, placeId: belgranoId, role: MembershipRole.MEMBER },
      {
        userId: userIds.exMember,
        placeId: palermoId,
        role: MembershipRole.MEMBER,
        leftAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    ],
  })

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
