# Gotchas

Comportamientos que (a) no son derivables del código, (b) tienen síntoma confuso, (c) volverían a morder. Criterio en `CLAUDE.md` § Gotchas.

- [Cookies `__Secure-` de Neon Auth requieren HTTPS](neon-auth-secure-cookie-https.md) — sesiones no persisten en dev local sobre http plano.
- [El driver `@neondatabase/serverless` no parsea uniformemente los arrays](neon-serverless-array-parsing.md) — `array_agg`/`text[]` vuelve como literal `'{a,b}'`, no array JS; usar `string_agg`+split en introspección/runtime.
- [next-intl tira `FORMATTING_ERROR` en plantillas `{x}` resueltas client-side](next-intl-icu-template-raw.md) — labels que el wizard rellena con `.replace`/`.split` deben leerse con `t.raw`, no `t()`.
- [Una branch-entorno de Neon sin migraciones aplicadas](neon-branch-sin-migraciones.md) — signup anda pero el place no se crea; el auth user queda en el branch del deploy sin schema. Aprovisionar por migraciones (ADR-0017).
