#!/usr/bin/env node
// Guard de aprovisionamiento de entornos por migraciones (ADR-0017 §Cierre del
// Watch, 2026-05-20). Cierra el gap operativo declarado en el §Watch del ADR
// tras el incidente del Hub V1 (2026-05-20): el deploy a Vercel empujó el
// código S2/S5 pero las migraciones 0004/0005 quedaron sin aplicar — la
// función `app.get_inbox_payload` no existía → 500 en
// `app.place.community/es`. Este script obliga al deploy a aprovisionar su
// branch destino ANTES de buildear (fail-closed: build aborta si el migrate
// falla, evitando un deploy con código adelantado del schema).
//
// Reglas (ADR-0017 §Decisión):
// 1. Sólo el **production deploy** corre migraciones contra la branch
//    `production` de Neon. `DATABASE_URL_MIGRATE` (rol `neondb_owner`, vía
//    `drizzle.config.ts`) debe estar seteada como env var de Vercel scoped a
//    Production (NUNCA en Preview ni Development scope — preview deploys NO
//    deben poder mutar prod schema). Si falta, el build aborta antes del
//    `next build`.
// 2. **Preview deploys** skip-ean: las preview branches efímeras se
//    aprovisionan fuera del flujo del deploy (creadas desde `production`
//    para probar). Política revisable si emerge la necesidad.
// 3. **Local `pnpm build`** (sin `VERCEL_ENV`) skip-ea: preserva el flujo dev
//    sin requerir credenciales admin localmente.
//
// `pnpm db:migrate` envuelve `drizzle-kit migrate` (declarativo en
// `drizzle.config.ts` → lee `process.env.DATABASE_URL_MIGRATE`). Idempotente:
// drizzle-kit calcula los hashes y aplica sólo lo que falta en
// `drizzle.__drizzle_migrations` del branch destino.

import { spawn } from "node:child_process";

const env = process.env.VERCEL_ENV;

if (env !== "production") {
  console.log(
    `[maybe-migrate] VERCEL_ENV=${env ?? "(unset)"} — skipping db:migrate (sólo production deploys migran, ADR-0017).`,
  );
  process.exit(0);
}

if (!process.env.DATABASE_URL_MIGRATE) {
  console.error(
    "[maybe-migrate] VERCEL_ENV=production pero DATABASE_URL_MIGRATE no está seteada en el environment de Vercel. Abort (fail-closed, ADR-0017).",
  );
  console.error(
    "[maybe-migrate] Setear: `vercel env add DATABASE_URL_MIGRATE production` con el connection string admin (`neondb_owner`) de la branch production.",
  );
  process.exit(1);
}

console.log(
  "[maybe-migrate] VERCEL_ENV=production — corriendo `pnpm db:migrate` contra production branch (ADR-0017 §Cierre del Watch)…",
);

const child = spawn("pnpm", ["db:migrate"], { stdio: "inherit", shell: false });

child.on("error", (err) => {
  console.error(`[maybe-migrate] spawn error: ${err.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (code === 0) {
    console.log("[maybe-migrate] db:migrate OK — schema sincronizado con repo.");
    process.exit(0);
  }
  console.error(
    `[maybe-migrate] db:migrate FAILED (code=${code}, signal=${signal}). Abort build (fail-closed per ADR-0017 — mejor no deploy que deploy con schema atrás).`,
  );
  process.exit(code ?? 1);
});
