# El driver `@neondatabase/serverless` no parsea uniformemente los arrays de Postgres

> Verificado empíricamente 2026-05-17 (S1, introspección de constraints sobre el branch `test`).

## Síntoma

Una query devuelve una columna de tipo array y el código que la consume "no encuentra nada" sin error: `.length`, `.includes()`, índices o `.map()` se comportan raro. Caso real (S1): un test que introspectaba constraints con

```sql
SELECT con.conname, array_agg(att.attname ORDER BY att.attnum) AS cols ...
```

esperaba `cols` como `string[]` y recibía el **string** `"{auth_user_id}"`. `cols.length` daba la longitud del string, `cols[0]` daba `"{"`, y las aserciones fallaban como si el schema estuviera mal — cuando el schema era correcto.

## Causa

El driver `@neondatabase/serverless` (Pool/Client sobre WebSocket) **no parsea todos los tipos array igual** que asumimos:

- Columnas array de catálogos del sistema con OID conocido (ej. `pg_constraint.conkey`, `int2vector`) **sí** vuelven como array JS (`[1, 2]`).
- El resultado de **`array_agg(...)`** (y en general `text[]` derivado) vuelve como **literal Postgres en string**: `"{a,b,c}"` — **no** un array JS.

Es decir: el tipo de retorno de una columna array **no es predecible** por inspección del código; depende del OID que Postgres asigne a esa expresión y de qué type-parsers tenga registrados el driver. `curl`/`psql` no exponen el problema (muestran el literal y uno lo lee "bien"), por eso pasa desapercibido hasta que el código JS opera sobre el valor.

## Solución

No asumir que una columna array llega como array JS. En queries de introspección/agregación:

- **Preferir `string_agg(col, ',' ORDER BY …)`** y `.split(",")` en JS — determinista, sin depender del parser del driver. Es el patrón usado en `src/db/__tests__/schema.test.ts`.
- Si se necesita un array genuino, parsear el literal `'{…}'` explícitamente (o castear en SQL a un tipo cuyo parser sí esté cubierto), nunca confiar en el default.
- Vale para **runtime** también, no solo tests: cualquier `array_agg`/columna `text[]` que la app lea con este driver debe tratarse con el mismo cuidado (RLS S2/S5 introspeccionan; features que devuelvan listas agregadas, idem).

## Notas

- No es un bug a "arreglar" en el driver: es comportamiento del transporte serverless de Neon; el contrato correcto es no asumir el shape.
- Relacionado: la estrategia de tests de DB (`docs/features/onboarding/tests.md` § Estrategia de DB de test) — toda introspección de schema/RLS pasa por este driver.
