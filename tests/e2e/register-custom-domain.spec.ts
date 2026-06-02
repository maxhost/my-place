import { expect, test } from "@playwright/test";

import { signUpOwner } from "./_support/bootstrap";

// E2E crítico #2 (Phase 2.B.1) — register custom domain. Recorre la
// estado-máquina del slice custom-domain (`docs/features/custom-domain/spec.md`
// §"UI states"): none → pending (tabla DNS) → verified → none.
//
// La verificación contra Vercel está MOCKEADA por un stub HTTP local
// (`scripts/e2e-vercel-stub.mjs`) al que el wrapper apunta vía
// `VERCEL_API_BASE_URL` (seam DI, ver docs/testing.md §"Mock de Vercel en
// E2E"). El stub responde:
//   - addDomain (POST v10): verified:false → el registro queda PENDING.
//   - getDomainConfig (GET v6): misconfigured:false → DNS OK.
//   - getDomainStatus (GET v9): verified:true → en el reload, el lazy poll
//     (verified && !misconfigured) hace UPDATE verified_at → VERIFIED.
//
// El owner se bootstrapea con el wizard de signup (`signUpOwner`); el settings
// vive en el subdominio del place (la sesión Neon Auth viaja con `Domain=.lvh.me`).
// Cleanup por patrón de email (place_domain incluido en el barrido FK-safe).

test("register custom domain: none → pending → verified → none", async ({
  page,
}) => {
  test.setTimeout(120_000);

  const stamp = `${Date.now()}`;
  const { slug } = await signUpOwner(page, stamp);
  const domain = `e2e-${stamp}.example.com`;

  // Settings en el subdominio del place. URL absoluta: el path NO lleva el slug
  // (va en el subdominio); el proxy reescribe a /place/{slug}/settings/domain.
  await page.goto(`https://${slug}.lvh.me:3000/settings/domain`);
  await page.waitForLoadState("networkidle");

  // ── Estado none — form de registro ──
  await expect(
    page.getByRole("heading", { name: "Dominio propio" }),
  ).toBeVisible({ timeout: 30_000 });
  // `textbox` por rol (no `getByLabel`): el sidebar tiene un link "Dominio"
  // hacia /settings/domain — un selector por label ambiguo lo matchearía
  // cuando el form no está montado. El rol textbox sólo matchea el input.
  const input = page.getByRole("textbox", { name: "Dominio" });
  const submit = page.getByRole("button", { name: "Vincular dominio" });
  await expect(input).toBeVisible();
  await expect(submit).toBeDisabled();

  // ── Vincular dominio → pending (verified:false del stub) ──
  await input.fill(domain);
  await expect(submit).toBeEnabled({ timeout: 15_000 });
  await submit.click();

  await expect(page.getByText("Verificando tu dominio")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("table")).toBeVisible(); // tabla DNS a configurar

  // ── Simular propagación DNS: el control E2E del stub marca el dominio como
  // "propagado" (V6 misconfigured:false + V9 verified:true). Modela al owner
  // que vuelve después de configurar el DNS. El puerto espeja VERCEL_STUB_PORT
  // de playwright.config.ts. ──
  await page.request.post(
    `http://127.0.0.1:3010/__advance?domain=${encodeURIComponent(domain)}`,
  );

  // ── Reload → lazy poll flip a verified ──
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Verificado, SSL activo")).toBeVisible({
    timeout: 30_000,
  });

  // ── Remover → confirm dialog → vuelta a none ──
  await page.getByRole("button", { name: "Remover" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Sí, remover" }).click();

  // El textbox sólo aparece en el estado none → esperar a que el archive
  // complete + re-renderice (no matchea el link "Dominio" del sidebar).
  const inputAgain = page.getByRole("textbox", { name: "Dominio" });
  await expect(inputAgain).toBeVisible({ timeout: 30_000 });
  await expect(inputAgain).toHaveValue("");
});
