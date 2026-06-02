import { expect, test } from "@playwright/test";

import { signUpOwner } from "./_support/bootstrap";
import {
  assertCleanupSafeEmail,
  lookupAuthUserIdByEmail,
  membershipExists,
  mintLocalSessionCookie,
  seedCustomDomainInvite,
} from "./_support/db-seed";

// E2E crítico #3 (Phase 2.B.2) — accept invite cross-domain. El escenario más
// frágil del V1.2: un invitee que aterriza en el invite link de un place CON
// custom domain verificado, se crea cuenta en el apex, y termina aceptando la
// invitación DESDE el custom domain (sesión local SSO, registrable domain
// distinto del apex).
//
// ## Camino activo: fallback documentado del plan (live SSO sustituido)
//
// La cadena SSO live (init→issue→redeem) es INTRATABLE en el harness local
// `:3000`: las rutas SSO (`buildSsoInitUrlForInvite`, `sso-issue` buildRedeemUrl,
// `sso-redeem` buildLandingUrl) reconstruyen el host del custom domain SIN
// puerto (`https://<host>/...` → `:443`), correcto para prod pero roto cuando
// todo corre en `:3000`. Arreglarlo exigiría tocar código de producción de
// routing (fuera de scope) o correr en `:443` (privilegiado, inviable en CI).
//
// Por eso sustituimos SÓLO los 3 hops del redirect SSO — ya cubiertos por sus
// `route.test.ts` (sso-init/issue/redeem) — minteando la cookie
// `__Host-place_sso_session` que el redeem habría emitido (`mintLocalSession`,
// misma signing key) e inyectándola en el custom domain. Todo lo demás corre
// REAL: signup del owner (wizard) + signup del invitee (apex AccessFlow) + seed
// del place_domain verified + invitación (DEFINER) + routing custom-domain del
// proxy + `verifyLocalSession` + `acceptInvitationAction` cross-domain +
// consumo del token. Ver docs/testing.md §"E2E accept invite cross-domain".
//
// Custom domain = `127.0.0.1.nip.io` (A-record IPv4-only; `localtest.me` trae
// AAAA → happy-eyeballs flakea contra `::1`). El cert E2E ya lo cubre en su SAN
// (scripts/ensure-e2e-cert.mjs). Cleanup por patrón de email (owner+invitee
// con prefijo `e2e-`; el barrido incluye place_domain + invitation + membership).

const CUSTOM_DOMAIN = process.env.E2E_CUSTOM_DOMAIN ?? "127.0.0.1.nip.io";

test("accept invite cross-domain: anon invite → signup → accept en custom domain", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000); // 2 signups (owner+invitee) sobre branch cold-start.

  const stamp = `${Date.now()}`;
  const inviteeEmail = `e2e-inv-${stamp}@example.com`;
  assertCleanupSafeEmail(inviteeEmail);

  // ── Owner: bootstrap vía wizard (crea place + place_ownership) ──
  const { slug, email: ownerEmail } = await signUpOwner(page, stamp);

  // ── Seed: place_domain verified + invitación pendiente para el invitee ──
  const { placeId, token } = await seedCustomDomainInvite({
    ownerEmail,
    placeSlug: slug,
    inviteeEmail,
    customDomain: CUSTOM_DOMAIN,
  });

  const inviteUrl = `https://${CUSTOM_DOMAIN}:3000/invite/${token}`;

  // Contexto separado para el invitee (incógnito respecto del owner). La cookie
  // apex del signup quedará en este contexto pero NO viaja al custom domain
  // (registrable domain distinto) — exactamente el gap que el SSO local cubre.
  const inviteeContext = await browser.newContext({ ignoreHTTPSErrors: true });
  const inviteePage = await inviteeContext.newPage();

  try {
    // ── (1) Anon en el invite del custom domain → variante unauth ──
    // Valida que el proxy clasifica el host como custom-domain (place_domain
    // verified) y reescribe a /place/{slug}/invite/{token}, y que el invite
    // page renderiza sin sesión (variante unauth = CTAs login/signup).
    //
    // Aserción por el CTA "Crear cuenta" (label SIN placeholder → resuelve): el
    // header/previewEmail usan `t()` sobre strings con `{placeName}`/`{email}`
    // → next-intl devuelve la KEY cruda (FORMATTING_ERROR pre-existente, ver
    // 2.B.1 + docs/testing.md), así que NO asertamos sobre ese texto.
    const signupLink = inviteePage.getByRole("link", { name: "Crear cuenta" });
    await inviteePage.goto(inviteUrl);
    await inviteePage.waitForLoadState("networkidle");
    await expect(signupLink).toBeVisible({ timeout: 30_000 });

    // ── (2) Signup REAL del invitee en el apex (cuenta sin place) ──
    // returnTo relativo `/es` → la nav post-success queda local (sin pegar al
    // Hub apex hardcodeado). El neon_auth.user se crea server-side antes de la
    // nav, así que la verdad la tomamos del DB poll, no del browser.
    await inviteePage.goto(
      `https://lvh.me:3000/es/login?mode=signup&returnTo=${encodeURIComponent("/es")}`,
    );
    await inviteePage.waitForLoadState("networkidle");

    const nameInput = inviteePage.getByLabel("Tu nombre");
    await expect(nameInput).toBeVisible({ timeout: 30_000 });
    await nameInput.fill("E2E Invitee");
    await inviteePage.getByLabel("Email").fill(inviteeEmail);
    await inviteePage.getByLabel("Contraseña").fill("e2e-password-123");
    await inviteePage.getByRole("checkbox").check();
    const createAccount = inviteePage.getByRole("button", {
      name: "Crear mi cuenta",
    });
    await expect(createAccount).toBeEnabled({ timeout: 15_000 });
    await createAccount.click();

    // Cuenta creada server-side (independiente de a dónde navegó el browser: el
    // post-success del AccessFlow apunta al Hub apex y puede colgar la página
    // del signup — por eso los pasos del custom domain corren en una PÁGINA
    // NUEVA, no en `inviteePage`). El sub es el neon_auth.user.id para mintear.
    let inviteeSub: string | null = null;
    await expect
      .poll(
        async () => {
          inviteeSub = await lookupAuthUserIdByEmail(inviteeEmail);
          return inviteeSub;
        },
        { timeout: 45_000, intervals: [1000, 2000, 3000] },
      )
      .not.toBeNull();

    // ── (3) Mintear + inyectar la cookie SSO local (sustituye el redeem) ──
    const cookie = await mintLocalSessionCookie({
      sub: inviteeSub!,
      customDomain: CUSTOM_DOMAIN,
    });
    await inviteeContext.addCookies([cookie]);

    // ── (4) Invite en el custom domain CON sesión local → variante match ──
    // Página NUEVA del mismo contexto (la cookie sso-local vive en el contexto):
    // evita arrastrar la navegación in-flight que dejó el signup en la página
    // del apex. Render autenticado sobre la cookie sso-local: `getCurrentUser
    // IdentityForRequest` resuelve el email del invitee en la zona custom-domain.
    // La variante match se confirma por el link "No, gracias" (declineLink, SIN
    // placeholder → resuelve) — sólo existe en match — + la desaparición del CTA
    // "Crear cuenta" de unauth. El botón Aceptar usa un label con `{placeName}`
    // (key cruda por FORMATTING_ERROR), así que lo targeteamos por rol (único en
    // la variante match), no por texto.
    const acceptPage = await inviteeContext.newPage();
    await acceptPage.goto(inviteUrl);
    await acceptPage.waitForLoadState("networkidle").catch(() => {});
    await expect(
      acceptPage.getByRole("link", { name: "No, gracias" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      acceptPage.getByRole("link", { name: "Crear cuenta" }),
    ).toHaveCount(0);

    // ── (5) Aceptar → membership cross-domain creada ──
    // NO esperamos navegación: el success del panel hace `navigate(placeHomeUrl)`
    // a un placeHomeUrl SIN puerto (portless) que no resuelve en `:3000` — deja
    // la página con una nav in-flight. La verdad la tomamos del DB (poll), no
    // del estado del browser. Poll holgado: el accept encadena 3 round-trips
    // Neon (identidad + ensureAppUser + accept_invitation) que en cold-start del
    // branch test pueden tardar.
    // Scopeado a `<main>`: en `next dev` el overlay de Dev Tools inyecta botones
    // a nivel body; el único botón dentro de main (variante match) es Aceptar.
    await acceptPage.locator("main").getByRole("button").click();
    await expect
      .poll(() => membershipExists({ inviteeEmail, placeId }), {
        timeout: 60_000,
        intervals: [1000, 2000, 3000, 5000],
      })
      .toBe(true);

    // ── (6) Re-visitar el invite → 404 (token consumido) ──
    // Página NUEVA (acceptPage quedó con la nav portless in-flight del success).
    // `app.invitation_preview` retorna null para tokens usados → notFound().
    const revisitPage = await inviteeContext.newPage();
    const revisit = await revisitPage.goto(inviteUrl);
    expect(revisit?.status()).toBe(404);
  } finally {
    await inviteeContext.close();
  }
});
