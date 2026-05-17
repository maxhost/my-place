# Cookies `__Secure-` de Neon Auth requieren HTTPS

> Verificado empíricamente 2026-05-16 (probe sobre branch Neon de prueba).

## Síntoma

En dev local sobre `http://localhost` (o `http://*.lvh.me`), después de sign-in/sign-up "no hay sesión": `auth.getSession()` devuelve `null`, el usuario parece deslogueado al instante, los flujos que dependen de la sesión fallan sin error claro.

## Causa

Neon Auth (`@neondatabase/auth`) emite las cookies de sesión con el prefijo **`__Secure-`**:

```
Set-Cookie: __Secure-neon-auth.session_token=…; Path=/; HttpOnly; Secure; SameSite=Strict
Set-Cookie: __Secure-neon-auth.local.session_data=<JWT>; …; Secure; …
```

Por RFC 6265bis, una cookie con prefijo `__Secure-` **solo es aceptada por el browser si viene con el atributo `Secure` y sobre una conexión HTTPS**. Sobre `http://` plano el browser **descarta silenciosamente** la cookie — el server la "setea" (se ve en la respuesta) pero el browser no la guarda. Con `curl` el problema no aparece (curl guarda igual), por eso puede pasar desapercibido en pruebas de terminal.

## Solución

Servir el dev local por **HTTPS**:

- `mkcert` + certificado local, o el flag de dev server con TLS, o un proxy local TLS. El host de dev debe ser `https://`.
- No "parchear" quitando el prefijo `__Secure-` (lo controla el SDK, no nosotros) ni desactivando `Secure` (rompería la seguridad de la cookie en prod).

## Notas

- En prod no aplica (todo es HTTPS).
- Relacionado: el modo por default (sin `cookies.domain`) emite la cookie host-only; con `createNeonAuth({ cookies: { domain: ".place.community" } })` se emite con `Domain` apex (cross-subdomain). Ver `architecture.md` § "Sesión y SSO".
- `__Secure-neon-auth.local.session_data` es un JWT con `exp` ~300s (cache de sesión, `cookies.sessionDataTtl`); su TTL vs el `exp` real del token es un riesgo a vigilar en S1 (ver `multi-tenancy.md` § RLS).
