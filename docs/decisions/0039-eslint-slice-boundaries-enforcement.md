# ADR-0039 — Enforcement de slice boundaries vía eslint built-in `no-restricted-imports`

**Fecha**: 2026-05-25
**Estado**: Adoptada
**Contexto inmediato**: Feature E (members slice V1) — sesión S10.5.5 (pre-refactor del slice diet S10.6-S10.9). Cierre del drift doc↔código detectado en gap-scan pre-aprobación del plan slice-split.

## Contexto

`docs/architecture.md` §17-25 declara dos reglas inviolables del paradigma vertical-slice:

1. **Una feature nunca importa archivos internos de otra**. Solo consume lo que la otra exporta en su `public.ts`.
2. **`shared/` nunca importa de `features/`**.

Hasta esta ADR, `architecture.md:19` afirmaba: _"Enforzadas por eslint con `no-restricted-paths`"_. Pero el `eslint.config.mjs` real sólo cargaba `nextCoreWebVitals + nextTypescript` — **sin ningún rule de boundaries**. Drift de ~7 meses: la doc canónica prometía enforcement automático que no existía.

El drift se detectó como gap-scan blocker en la sesión de planning de S10.6+ (extracción de 3 sub-slices de Feature E). Si la regla se hubiera cumplido durante S10.5, la decisión arquitectónica de poner los wrappers Feature D en `members-ownership/` y consumirlos cross-slice desde `members/ui/` habría sido validada por la herramienta — sin necesitar inspección manual.

Auditoría del codebase pre-ADR (`grep -rn "from \"@/features/" src/`):

- `src/shared/` → 0 imports de `@/features/*` ✓
- `src/app/` → todos via `@/features/*/public` ✓
- `src/features/X → features/Y` → **2 occurrences**, ambas en `custom-domain-verification` deep-importando a `@/features/custom-domain/types/custom-domain`. El motivo está documentado inline en `_v6-helpers.ts:6-10`: **el barrel `custom-domain/public.ts` re-exporta `registerCustomDomainAction` `"use server"` → import en test arrastra `next/headers` → vitest crashea**. Los mappers SÍ están expuestos en `public.ts:80-83`; el deep-import existe **sólo por restricción de testing**, no por gap de API pública. ADR-0030 §"el slice anfitrión es la SoT de DnsRecord y sus mappers" ya validó la dependencia cross-slice.

Esta ADR (a) cierra el drift activando enforcement, (b) decide la regla con criterio explícito para el caso aislado, (c) re-alinea `architecture.md:19` con la herramienta real.

## Decisión

Adoptar **ESLint built-in `no-restricted-imports`** con dos rule blocks layered en `eslint.config.mjs`:

### Rule 1 — Cross-slice imports sólo via `/public`

```js
files: ["src/**/*.{ts,tsx}"],
rules: {
  "no-restricted-imports": ["error", {
    patterns: [{
      group: ["@/features/*/!(public)", "@/features/*/!(public)/**"],
      message: "Cross-slice imports sólo via @/features/<slice>/public ..."
    }]
  }]
}
```

### Rule 2 — `shared/` NUNCA importa `features/`

```js
files: ["src/shared/**/*.{ts,tsx}"],
rules: {
  "no-restricted-imports": ["error", {
    patterns: [{
      group: ["@/features/*", "@/features/*/**"],
      message: "shared/ NUNCA importa de features/ ..."
    }]
  }]
}
```

ESLint flat config NO merge-ea options de la misma rule: el segundo block reemplaza el primero para `src/shared/**`. Eso es intencional — la regla shared es strictly stronger.

### Escape hatch documentado (Path B)

Para el caso `custom-domain-verification → custom-domain/types/custom-domain` (workaround Vitest), se agregó `// eslint-disable-next-line no-restricted-imports -- <rationale completo>` en las 2 líneas afectadas:

- `src/features/custom-domain-verification/actions/_v6-helpers.ts:15`
- `src/features/custom-domain-verification/actions/__tests__/v6-helpers.test.ts:14`

El comentario incluye: motivo (next/headers en barrel), referencia al rationale extendido del archivo, y el ADR justificante. Cualquier nuevo cross-slice deep-import queda bloqueado por default — la excepción es declarativa, no implícita.

## Alternativas rechazadas

### Path A — Allow `@/features/*/types/**` como segundo entry point cross-slice

Codificar "tipos puros y helpers side-effect-free son exportables cross-slice sin tocar el barrel" como regla.

**Rechazada porque**: relaja el contrato preventivamente para resolver UN caso real. El slice anfitrión dejaría de tener una sola API curada; cualquier cosa metida bajo `types/` quedaría accesible cross-slice automáticamente — el "front door" único deja de ser único. Over-design: 2 occurrences no justifican una segunda convención permanente.

### Path C — Split `public.ts` en dos barrels (`public.ts` full + `public.pure.ts` types-only)

Refactor estructural: cualquier slice con server actions agrega un segundo barrel para imports testables.

**Rechazada porque**: introduce convención nueva sin precedente en el repo, ceremonia extra (dos barrels por slice con server actions). Mismo over-design que Path A con peor surface area. Si en el futuro 3+ slices necesitan el escape hatch, se promueve a Path A o C con ADR retroactiva y evidencia.

### `eslint-plugin-import` (su rule `no-restricted-paths`)

Aspiracionalmente nombrada en `architecture.md:19` pre-ADR. **Rechazada porque**: agrega dependencia (`eslint-plugin-import` + `eslint-plugin-import-x` para flat config robusto) sin ventaja semántica sobre el built-in para nuestro grafo (slices son directorios homogéneos `src/features/*/`). El built-in `no-restricted-imports` con `patterns + group` cubre los 2 casos con sintaxis estándar mantenida por ESLint upstream.

### `eslint-plugin-boundaries` (slice-aware con DSL propio)

Plugin opinionated para arquitecturas slice-based con concept de "elements" y rules entre ellos.

**Rechazada porque**: dependencia heavy, learning curve, mismo outcome que built-in para nuestras 2 reglas. Reservado como escape si el grafo crece a 4+ tipos de elementos (no es el caso V1).

## Consecuencias

### Adoptadas

- **Drift cerrado**: `architecture.md:19` ahora cita el rule real (`no-restricted-imports`) y referencia ADR-0039. La promesa de enforcement automático se cumple.
- **Going-forward enforcement**: cualquier futuro cross-slice deep-import (regla 1) o import desde `shared/` hacia `features/` (regla 2) falla el `pnpm lint` → CI bloquea. Reduce review-overhead de slice boundaries de manual a automático.
- **Intra-slice no afectado**: la regla 1 sólo bloquea `@/features/X/<not-public>`. Los imports intra-slice usan paths relativos (`../actions/foo`) por convención existente — verificado en audit (0 occurrences de `@/features/X/...` dentro de la propia feature X).
- **2 escape hatches declarados**: las 2 líneas en `custom-domain-verification` quedan marcadas con `eslint-disable-next-line` + rationale completo. La excepción es auditable.

### Forward-compat

- Si más slices ganan server actions en su `public.ts` y necesitan tests puros con deep-import → revisar si la frecuencia justifica promoción a Path A (allow `types/**`) o Path C (split barrel). Threshold informal: 3+ occurrences distintas en 2+ slices.
- Si en el futuro un slice necesita exportar un sub-barrel adicional (ej. `public-client.ts` para Client Components solamente), evaluar extender la regla 1 para permitir `@/features/*/public*` (glob) en lugar de `@/features/*/public` (exact). Cambio backward-compat.

### Migration retroactiva

Esta ADR NO requiere migration — el audit pre-ADR confirmó que el codebase ya cumple las 2 reglas excepto las 2 occurrences ya cubiertas por el escape hatch. La adopción es **zero-friction**: el `pnpm lint` post-ADR pasa sin tocar lógica de negocio.

## Verificación

Post-config, los siguientes comandos deben pasar verdes:

- `pnpm lint` — 0 errors (las 2 violations existentes quedan suprimidas por `eslint-disable-next-line`).
- `pnpm typecheck` — sin cambios (la regla es lint-only).
- `pnpm test` — sin cambios (los tests no dependen del lint).

## Referencias

- `docs/architecture.md` §17-25 (Reglas de aislamiento entre módulos)
- ADR-0030 (Custom Domain split by operation layer) — valida la dependencia cross-slice `verification → custom-domain` y la SoT de `DnsRecord`
- ADR-0014/0015/0016/0028 — precedentes de slice promotion con dependencia unidireccional cross-slice via `public.ts`
- `eslint.config.mjs` — config canónica
- `src/features/custom-domain-verification/actions/_v6-helpers.ts:6-15` — rationale extendido del escape hatch
- `src/features/custom-domain/types/custom-domain.ts:17-26` — SoT del cross-slice deep-import documentado
