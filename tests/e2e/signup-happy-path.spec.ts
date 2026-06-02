import { test } from "@playwright/test";

import { signUpOwner } from "./_support/bootstrap";

// E2E crítico #1 (Phase 2.A) — happy path place-first: apex `/crear` → wizard
// 3 pasos (identidad → estilo → cuenta) → signUp + app.create_place → success
// screen. Corre contra la app local sobre `lvh.me` apuntada al branch `test`
// de Neon (ver docs/testing.md). El cleanup de la cuenta creada lo hace el
// globalTeardown por patrón de email (prefijo `e2e-`, invariante en
// `signUpOwner`). El flujo del wizard vive en el helper compartido
// `_support/bootstrap.ts` (reusado por register-custom-domain, Phase 2.B.1);
// este spec verifica que el bootstrap completa hasta la success screen.

test("place-first: signup + creación de place → success screen", async ({
  page,
}) => {
  test.setTimeout(120_000);

  // `signUpOwner` corre el wizard completo y asserta la success screen
  // ("Tu lugar está listo") internamente — ESA es la verificación de este E2E.
  await signUpOwner(page);
});
