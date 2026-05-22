// Interfaz pública del slice `custom-domain-verification` (paradigma
// vertical-slice `docs/architecture.md` §17-25). Promovido en S2.c del
// fix verified-false-positive (ADR-0030, 2026-05-22) por overflow del
// cap LOC del slice anfitrión `custom-domain` al absorber la lógica
// dual V9+V6 introducida por ADR-0029.
//
// COMPONENTES PÚBLICOS:
//
//   - **`getCustomDomainStatus(placeId)`**: helper-server (NO Server
//     Action — sin `"use server"`) que ejecuta el lazy poll consolidado:
//     SELECT de la fila activa → GET Vercel V6 SIEMPRE (chequea DNS
//     dinámico) → GET Vercel V9 condicional (sólo si verifiedAt NULL,
//     para confirmar ownership) → decisión consolidada via helper puro
//     `decideDomainFlow` → side-effects DB selectivos (UPDATE
//     verified_at=now() | UPDATE verified_at=NULL | nada) → retorna
//     `CustomDomainState` (discriminated union).
//
// CONSUMERS V1:
//   - `src/app/(app)/place/[placeSlug]/settings/domain/page.tsx` —
//     Server Component que orquesta el cableado.
//
// FORWARD-COMPAT (ADR-0030 §"Forward-compat con Features B y C"):
//   - Feature B (host routing edge): consumirá una variante edge-friendly
//     del lookup (`app.lookup_place_by_domain` SECURITY DEFINER) +
//     potencialmente cachear V6.
//   - Feature C (OIDC SSO callback): consumirá `getCustomDomainStatus`
//     para validar que el dominio está verified antes de emitir cookie
//     local del custom domain.
//
// HELPERS PRIVADOS (`./actions/_v6-helpers.ts`): `v6ConfigToDnsRecords`,
// `vercelRecordsToDnsRecords`, `decideDomainFlow`. NO se re-exportan
// (prefijo `_` los marca privados). Los tests viven junto a la lógica
// (`./actions/__tests__/v6-helpers.test.ts`, 17 casos del flow puro).
//
// CANON Server Actions (`update-default-locale.ts:13`): el lazy poll
// arrastra `next/headers` + Neon Auth + DB y NO se testea con vitest;
// su correctitud es tipo/build + smoke vivo. Las piezas puras
// (`_v6-helpers`) SÍ se testean.
//
// TIPOS: los tipos del dominio (`CustomDomainState`, `DnsRecord`,
// `CustomDomainRecord`) viven en `@/features/custom-domain/public` y se
// importan desde acá vía barrel cross-slice (paradigma vertical-slice
// permite features comunicarse así). Este sub-slice NO duplica los tipos.

export { getCustomDomainStatus } from "./actions/get-custom-domain-status";
