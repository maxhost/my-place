// Genera (idempotente) el cert self-signed para servir el dev server de los
// E2E sobre `https://lvh.me:3000`. Neon Auth (Better Auth) rechaza orígenes
// `http://` no-localhost en sus `trusted_origins` → el signup E2E DEBE correr
// sobre HTTPS (ver docs/testing.md §"Por qué HTTPS"). El cert es self-signed
// (Playwright corre con `ignoreHTTPSErrors`), sin mkcert/sudo: openssl alcanza.
//
// El mismo cert sirve `lvh.me` (apex E2E) Y el custom domain de la Phase 2.B.2
// (`E2E_CUSTOM_DOMAIN`, default `127.0.0.1.nip.io`): el dev server usa un único
// par key/cert por SNI, así que el SAN debe cubrir ambos registrable domains.
// Se usa `127.0.0.1.nip.io` (A-record IPv4-only) en vez de `localtest.me`
// (A+AAAA → happy-eyeballs puede pegarle a `::1` y flakear) para emparejar el
// stack IPv4 de `lvh.me`. Ver docs/testing.md §"E2E accept invite cross-domain".
//
// Idempotente con upgrade: si ambos archivos ya existen Y el cert YA cubre el
// custom domain en su SAN, no hace nada. Si existe un cert viejo (Phase 2.B.1,
// sin el custom domain en el SAN) lo regenera. `certificates/` está gitignored
// — cada dev/CI lo regenera en el primer `pnpm e2e`.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const dir = path.join(process.cwd(), "certificates");
const keyPath = path.join(dir, "lvh.me-key.pem");
const certPath = path.join(dir, "lvh.me.pem");

// Default alineado con tests/e2e/accept-invite-cross-domain.spec.ts. El script
// corre como node plano (sin `.env.e2e` cargado), así que el default vive acá.
const CUSTOM_DOMAIN = process.env.E2E_CUSTOM_DOMAIN ?? "127.0.0.1.nip.io";

/** ¿El cert existente ya incluye el custom domain en su subjectAltName? */
function certCoversCustomDomain() {
  try {
    const out = execFileSync(
      "openssl",
      ["x509", "-in", certPath, "-noout", "-ext", "subjectAltName"],
      { encoding: "utf8" },
    );
    return out.includes(CUSTOM_DOMAIN);
  } catch {
    return false;
  }
}

if (existsSync(keyPath) && existsSync(certPath) && certCoversCustomDomain()) {
  process.exit(0);
}

mkdirSync(dir, { recursive: true });

try {
  execFileSync(
    "openssl",
    [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "365",
      "-keyout", keyPath,
      "-out", certPath,
      "-subj", "/CN=lvh.me",
      "-addext",
      // `*.lvh.me` (wildcard) cubre los subdominios de place; el custom domain
      // es multi-label (no lo cubre un wildcard) → entra explícito en el SAN.
      `subjectAltName=DNS:lvh.me,DNS:*.lvh.me,DNS:localhost,DNS:${CUSTOM_DOMAIN},IP:127.0.0.1`,
    ],
    { stdio: "ignore" },
  );
  console.log(
    `[e2e] cert self-signed generado en certificates/ (SAN incluye ${CUSTOM_DOMAIN})`,
  );
} catch (err) {
  console.error(
    "[e2e] no se pudo generar el cert con openssl. ¿Está openssl en PATH?\n" +
      (err instanceof Error ? err.message : String(err)),
  );
  process.exit(1);
}
