// Genera (idempotente) el cert self-signed para servir el dev server de los
// E2E sobre `https://lvh.me:3000`. Neon Auth (Better Auth) rechaza orígenes
// `http://` no-localhost en sus `trusted_origins` → el signup E2E DEBE correr
// sobre HTTPS (ver docs/testing.md §"Por qué HTTPS"). El cert es self-signed
// (Playwright corre con `ignoreHTTPSErrors`), sin mkcert/sudo: openssl alcanza.
//
// Idempotente: si ambos archivos ya existen, no hace nada. `certificates/` está
// gitignored — cada dev/CI lo regenera en el primer `pnpm e2e`.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const dir = path.join(process.cwd(), "certificates");
const keyPath = path.join(dir, "lvh.me-key.pem");
const certPath = path.join(dir, "lvh.me.pem");

if (existsSync(keyPath) && existsSync(certPath)) {
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
      "subjectAltName=DNS:lvh.me,DNS:*.lvh.me,DNS:localhost,IP:127.0.0.1",
    ],
    { stdio: "ignore" },
  );
  console.log("[e2e] cert self-signed generado en certificates/");
} catch (err) {
  console.error(
    "[e2e] no se pudo generar el cert con openssl. ¿Está openssl en PATH?\n" +
      (err instanceof Error ? err.message : String(err)),
  );
  process.exit(1);
}
