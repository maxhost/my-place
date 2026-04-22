---
status: aceptada
fecha: 2026-04-21
---

# `pgbouncer=true` en `DATABASE_URL` (runtime) + `DIRECT_URL` sin flag (migraciones)

## Contexto

`DATABASE_URL` apunta al pooler de Supabase (Supavisor) en **transaction mode**, puerto 6543. En ese modo el pooler no mantiene una conexión fija por cliente: cada transacción del caller se multiplexa sobre una conexión compartida del pool, y al terminar (COMMIT/ROLLBACK) la conexión vuelve al pool y puede ir a otro cliente.

Prisma, por default, usa **prepared statements con nombre**: en el primer uso de una query hace `PREPARE stmt_<hash> AS ...`, y en los siguientes usos ejecuta `EXECUTE stmt_<hash>`. Ese nombre vive **en la sesión Postgres**, no en la connection pool lógica. En transaction mode, el prepared statement que Prisma creó en una transacción puede resultar "colgado" en una conexión física que ya no nos pertenece — y cuando Prisma intenta reutilizarlo, Postgres responde `prepared statement "stmt_..." does not exist`.

El workaround estándar (histórico de PgBouncer, heredado por Supavisor) es que el cliente emita `DEALLOCATE ALL` al final de cada transacción. Prisma, cuando detecta `?pgbouncer=true` en la URL, cambia la estrategia: usa statements anónimos (plan inline por query, sin `PREPARE`). Sin el flag, Prisma mantiene el modo por-nombre y agrega `DEALLOCATE ALL` entre transacciones — lo cual **funciona pero cuesta round-trips extra**: `BEGIN / DEALLOCATE ALL / query / COMMIT` = 4 round-trips por query trivial.

`connection_limit=1` acota el tamaño del pool Prisma-side a una sola conexión concurrente por instancia Node. En serverless/edge eso es ideal (cada función tiene su propio proceso), y en dev local hace el debugging de locks más predecible. Para picos de concurrencia el pool que importa es el de Supavisor (compartido por todos los procesos), no el de Prisma.

`DIRECT_URL` apunta al pooler en **session mode**, puerto 5432. Prisma lo usa únicamente para migraciones (`prisma migrate`, `prisma db push`) y `prisma studio`. Esas operaciones requieren una conexión dedicada con comandos DDL (`CREATE TABLE`, locks de schema) que transaction mode rechaza. `DIRECT_URL` **no lleva** `pgbouncer=true` — en session mode Prisma debe poder usar prepared statements con nombre normalmente.

## Decisión

- `DATABASE_URL` (runtime): `...pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1`
- `DIRECT_URL` (migraciones): `...pooler.supabase.com:5432/postgres` (sin flags)

Ambas URLs ya están así tanto en `.env.local` como en `.env.example`. Este ADR documenta por qué el flag es obligatorio y qué pasa si alguien lo saca "para limpiar".

## Alternativas consideradas

**A — Sin `pgbouncer=true`.** Prisma sigue creando prepared statements con nombre y emite `DEALLOCATE ALL` entre transacciones. Funciona, pero multiplica round-trips por cada query trivial. En Supabase Cloud (us-west-2 desde mi latencia actual) cada round-trip suma ~15–40ms. Una pantalla que hace 6 queries triviales se va a ~600ms solo por DB. Rechazada por costo de latencia.

**B — `connection_limit` mayor (ej 5).** El pool Prisma-side crece pero en serverless cada instancia es un proceso, así que el fan-out real viene del tamaño del pool de Supavisor. Más connections Prisma-side significan más locks competitivos sobre el mismo pool global sin ganancia real. `1` es el valor recomendado por Supabase para runtimes serverless; lo mantenemos también en dev local para que el comportamiento de locks sea el mismo entre ambientes.

**C — Apuntar runtime al session pooler (5432).** Elimina el problema de prepared statements pero cada request tiene que negociar una conexión dedicada — inviable bajo concurrencia real. Session mode queda solo para migraciones.

**D — Apuntar a la DB directa (no pooler).** Postgres directo no escala a serverless: límite duro de ~60 conexiones concurrentes en el plan free de Supabase. El pooler existe exactamente para evitar esto.

## Tradeoffs aceptados

- **Statements anónimos son microscópicamente más lentos por query individual** que prepared statements con plan cacheado. En la práctica el delta es ns vs los ms del round-trip ahorrado. Ganan los ms.
- **Sin prepared statements compartidos entre requests**, perdemos la optimización de "plan cache" de Postgres para queries idénticas. Irrelevante para la carga de Place (no-OLTP-intensivo).
- **`connection_limit=1` significa que una query lenta bloquea al resto del proceso Node.** Aceptable: Next.js abre procesos ansiosamente, y si una query es tan lenta como para ser el cuello, el fix está en la query, no en más conexiones.

## Operación

- Al resetear la `Database password` en Supabase Dashboard, hay que actualizar **ambas** URLs (`DATABASE_URL` y `DIRECT_URL`) — comparten credencial.
- `pgbouncer=true` **va solo en `DATABASE_URL`**. Si se copia por accidente a `DIRECT_URL`, las migraciones rompen con `ERROR: prepared statements are not supported for this connection`.
- Reiniciar dev server tras tocar cualquiera de las dos URLs — el `PrismaClient` vive cacheado en `globalThis` (ver `src/db/client.ts`) y hot-reload no lo refresca.

## Referencias

- `.env.local`, `.env.example` — valores vigentes
- `src/db/client.ts` — singleton Prisma + caché en `globalThis`
- Prisma docs — [Connection pool with PgBouncer](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/pgbouncer)
- Supabase docs — [Connecting with Prisma](https://supabase.com/docs/guides/database/prisma)
- CLAUDE.md § Gotchas — "Supabase connection string: copiar literal del dashboard" y "Cambiar `DATABASE_URL` / `DIRECT_URL` requiere reiniciar el dev server"
