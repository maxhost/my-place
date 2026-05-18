import { type JWTPayload, createRemoteJWKSet, jwtVerify } from "jose";

// Claims verificados del access token de Neon Auth. `sub` = neon_auth.user.id
// (lo que app.current_user_id() extrae para RLS). Garantizado no vacío.
export interface VerifiedClaims extends JWTPayload {
  sub: string;
}

type KeyResolver = Parameters<typeof jwtVerify>[1];

let remoteJwks: ReturnType<typeof createRemoteJWKSet> | undefined;

// Resolver perezoso: jose sólo lo invoca DESPUÉS de parsear el JWS compacto,
// así un token malformado falla antes de tocar la red/el env (fail-closed
// real, no por env ausente). El JWKS remoto se construye una sola vez.
const lazyRemoteResolver: KeyResolver = (protectedHeader, token) => {
  if (!remoteJwks) {
    const url = process.env.NEON_AUTH_JWKS_URL;
    if (!url) throw new Error("NEON_AUTH_JWKS_URL no configurada");
    remoteJwks = createRemoteJWKSet(new URL(url));
  }
  return remoteJwks(protectedHeader, token);
};

// Verifica firma + expiración contra el JWKS (remoto por defecto; inyectable
// para tests con un JWKS local). Sin `sub` → rechaza (la policy denegaría).
export async function verifyAccessToken(
  token: string,
  keys: KeyResolver = lazyRemoteResolver,
): Promise<VerifiedClaims> {
  const { payload } = await jwtVerify(token, keys);
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("access token sin claim `sub`");
  }
  return payload as VerifiedClaims;
}
