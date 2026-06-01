import { expect, test } from "@playwright/test";

import { E2E_EMAIL_PATTERN } from "./_support/db-cleanup";

// E2E crítico #1 (Phase 2.A) — happy path place-first: apex `/crear` → wizard
// 3 pasos (identidad → estilo → cuenta) → signUp + app.create_place → success
// screen. Corre contra la app local sobre `lvh.me` apuntada al branch `test`
// de Neon (ver docs/testing.md). El cleanup de la cuenta creada lo hace el
// globalTeardown por patrón de email — por eso el email DEBE usar el prefijo
// `e2e-` (invariante chequeado abajo).

test("place-first: signup + creación de place → success screen", async ({
  page,
}) => {
  test.setTimeout(120_000);

  const stamp = `${Date.now()}`;
  const placeName = `E2E ${stamp}`; // slug se auto-deriva → `e2e-<stamp>`
  const email = `e2e-${stamp}@example.com`;
  const password = "e2e-password-123";
  const displayName = "E2E Tester";

  // Invariante de cleanup: si el email no matchea el patrón de test
  // (`e2e-%@example.com`), el teardown no lo barrería y dejaría data huérfana
  // en el branch.
  const [prefix, suffix] = E2E_EMAIL_PATTERN.split("%");
  expect(email.startsWith(prefix) && email.endsWith(suffix)).toBe(true);

  await page.goto("/es/crear");
  await page.waitForLoadState("networkidle");

  // ── Paso 1 — Identidad (slug auto-derivado del nombre) ──
  const nameInput = page.getByLabel("Nombre del lugar");
  const preview = page.getByRole("figure", { name: "Así se va a ver" });
  await expect(nameInput).toBeVisible();
  // Gate de hidratación: re-llena hasta que el preview (estado React) refleje
  // el valor — el branch test cold-startea y la hidratación tarda.
  await expect(async () => {
    await nameInput.fill(placeName);
    await expect(preview).toContainText(placeName, { timeout: 1000 });
  }).toPass({ timeout: 30_000 });

  const next = page.getByRole("button", { name: "Siguiente" });
  await expect(next).toBeEnabled({ timeout: 15_000 });
  await next.click();

  // ── Paso 2 — Estilo (defaults del preset son válidos) ──
  await expect(next).toBeEnabled({ timeout: 15_000 });
  await next.click();

  // ── Paso 3 — Cuenta ──
  await page.getByLabel("Tu nombre").fill(displayName);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("checkbox").check();
  const create = page.getByRole("button", { name: "Crear mi lugar" });
  await expect(create).toBeEnabled({ timeout: 15_000 });
  await create.click();

  // ── Resultado — success screen del wizard ──
  await expect(
    page.getByRole("heading", { name: "Tu lugar está listo" }),
  ).toBeVisible({ timeout: 30_000 });
});
