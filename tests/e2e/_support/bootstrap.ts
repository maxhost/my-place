import { expect, type Page } from "@playwright/test";

import { E2E_EMAIL_PATTERN } from "./db-cleanup";

// Bootstrap compartido de los E2E (Phase 2.B): crea un owner nuevo vía el
// wizard de signup (apex `/crear`) — place + usuario Neon Auth + sesión en un
// solo flujo. Lo reutilizan los specs que necesitan partir de un owner
// autenticado (register custom domain, accept invite cross-domain). Evita
// seedear un usuario "login-able" en el backend gestionado de Neon Auth, que
// las factories deliberadamente NO crean (decisión 1.C del tracker).
//
// El email usa el prefijo `e2e-` (invariante del cleanup por patrón). El slug
// se auto-deriva del nombre (`E2E <stamp>` → `e2e-<stamp>`) — lo devolvemos
// para que el caller navegue al subdominio del place (`<slug>.lvh.me:3000`).
// La sesión Neon Auth queda con `Domain=.lvh.me` (auth-config.ts) → viaja a
// todos los subdominios.

export interface SignedUpOwner {
  email: string;
  password: string;
  displayName: string;
  placeName: string;
  slug: string;
}

export async function signUpOwner(
  page: Page,
  stamp: string = `${Date.now()}`,
): Promise<SignedUpOwner> {
  const placeName = `E2E ${stamp}`;
  const slug = `e2e-${stamp}`;
  const email = `e2e-${stamp}@example.com`;
  const password = "e2e-password-123";
  const displayName = "E2E Tester";

  // Invariante de cleanup: el teardown sólo barre emails que matchean el patrón.
  const [prefix, suffix] = E2E_EMAIL_PATTERN.split("%");
  expect(email.startsWith(prefix) && email.endsWith(suffix)).toBe(true);

  await page.goto("/es/crear");
  await page.waitForLoadState("networkidle");

  // ── Paso 1 — Identidad (slug auto-derivado del nombre) ──
  // Gate de hidratación: re-llena hasta que el preview (estado React) refleje
  // el valor — el branch test cold-startea y la hidratación tarda.
  const nameInput = page.getByLabel("Nombre del lugar");
  const preview = page.getByRole("figure", { name: "Así se va a ver" });
  await expect(nameInput).toBeVisible();
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

  // ── Success screen → sesión Neon Auth seteada (Domain=.lvh.me) ──
  // 45s: el signUp (Neon Auth) + app.create_place sobre el branch test
  // cold-started puede tardar; con 2 specs que bootstrapean por run, 30s
  // flakeaba en el primer intento. Holgado dentro del setTimeout(120s) del spec.
  await expect(
    page.getByRole("heading", { name: "Tu lugar está listo" }),
  ).toBeVisible({ timeout: 45_000 });

  return { email, password, displayName, placeName, slug };
}
