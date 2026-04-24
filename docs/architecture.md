# Arquitectura de Place

Paradigma: **Modular Monolith con Vertical Slices**. Priorizamos calma, estabilidad y mantenibilidad por una sola persona.

Este documento es el índice de las decisiones arquitectónicas. El detalle de cada área vive en `docs/`.

## Principios de organización

- **Vertical slices sobre capas horizontales**: cada feature agrupa toda su lógica —UI, server actions, queries, schemas, tests— en un único directorio.
- **Cajitas ordenadas, puertitas pequeñas**: los slices son autocontenidos y solo exponen una API mínima vía `public.ts`.
- **Server-first**: la lógica vive en el servidor; el cliente recibe HTML y pequeñas islas interactivas.
- **Colocation**: lo que cambia junto, vive junto.
- **Simplicidad antes que novedad**: preferimos piezas pocas y confiables sobre arquitecturas distribuidas.

## Reglas de aislamiento entre módulos

Inviolables. Enforzadas por eslint con `no-restricted-paths`.

- Una feature nunca importa archivos internos de otra. Solo consume lo que la otra exporta en su `public.ts`.
- `shared/` nunca importa de `features/`.
- El acceso a la DB se hace desde `queries.ts` y `actions.ts` del propio feature. Nunca desde componentes ni otras features.
- Las rutas en `src/app/` son delgadas: importan desde features y renderizan.
- Dependencias entre features son unidireccionales. Si aparece un ciclo, extraer la parte común a `shared/`.

## Estructura de directorios

```
src/
├── app/          Next.js App Router (delgado, delega a features)
├── features/     Un directorio por vertical slice
├── shared/       Primitivos agnósticos al dominio (ui, lib, hooks, config)
└── db/           Schema Prisma, migraciones, cliente
```

## Límites de tamaño

- Archivo: máximo 300 líneas
- Función: máximo 60 líneas
- Feature completa: máximo 1500 líneas
- Servicio/módulo en `shared/`: máximo 800 líneas

Superar un límite es señal de que hay que dividir.

## Regla de sesiones

- Una sesión = una cosa. Nunca mezclar capas (UI + lógica, DB + API, migración + feature).
- Si un cambio toca más de 5 archivos o cruza backend/frontend, partir en múltiples sesiones.
- Si una funcionalidad no cabe cómodamente en el 70% de la ventana de contexto, dividir.
- Al terminar, auto-verificar: `pnpm test`, `pnpm typecheck`, y reportar líneas de archivos tocados.

## Documentos de detalle

Cada área técnica tiene su propio documento. Leer el relevante antes de implementar.

- [`docs/stack.md`](docs/stack.md) — stack técnico completo y variables de entorno
- [`docs/multi-tenancy.md`](docs/multi-tenancy.md) — routing por subdomain, DNS, middleware
- [`docs/data-model.md`](docs/data-model.md) — schema Prisma e invariantes del dominio
- [`docs/feature-flags.md`](docs/feature-flags.md) — registro central y activación por place
- [`docs/billing.md`](docs/billing.md) — los tres modos de pago y estados del place
- [`docs/realtime.md`](docs/realtime.md) — dónde usamos Supabase Realtime y dónde no
- [`docs/notifications.md`](docs/notifications.md) — qué sí y qué no hay en el MVP
- [`docs/theming.md`](docs/theming.md) — CSS variables configurables por place
- [`docs/roadmap.md`](docs/roadmap.md) — orden de construcción del MVP y lo que no construimos

## Checklist de validación por feature

Antes de dar por terminada una feature, verificar:

- [ ] Todos los archivos viven dentro de `src/features/<feature>/`
- [ ] No hay imports cruzados hacia archivos internos de otras features
- [ ] Ningún archivo supera 300 líneas ni función 60
- [ ] Feature completa ≤ 1500 líneas
- [ ] Dependencias externas son solo `db/`, `shared/` y otras features vía `public.ts`
- [ ] Existe spec en `docs/features/<feature>/`
- [ ] Respeta los principios no negociables (ver `CLAUDE.md`)
- [ ] `pnpm test` y `pnpm typecheck` pasan en verde
