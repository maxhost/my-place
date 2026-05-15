# Landing pública de Place — spec + plan

> **Estado:** spec de diseño (NO implementada). Esto es documentación
> accionable: un dev debe poder construir la landing leyendo estos 4
> archivos sin inventar nada. NO hay código en `src/` todavía.
>
> ⚠️ **Pre-reset:** estos 4 archivos son anteriores al reset a scaffold
> limpio. Referencian docs eliminados (`blueprint.md`, `roadmap.md`,
> `theming.md`, `docs/features/*`) y `architecture.md` (de esta carpeta)
> describe el stack viejo (Supabase/Prisma). Tomar la **intención de
> diseño/contenido** como válida; ignorar los detalles de stack y los
> links a docs borrados hasta una pasada de actualización dedicada.

## Objetivo

La landing es **la puerta**. Es lo que ve TODA persona no logueada que
entra al dominio apex de Place (hoy `lvh.me:3000` en dev; ver
[decisión D1](#decisiones-abiertas) sobre el apex de producción). Su
único trabajo es:

1. Explicar **qué es Place** con el tono correcto (cozytech, íntimo, nada
   grita) sin prometer features que no existen.
2. Llevar a la persona a **registrarse / entrar** (`/login`), desde donde
   el flujo de onboarding decide: crear place / unirse vía directorio /
   aceptar invitación (ver `docs/rls/place-access.md` § "Crear" y
   `docs/features/places/spec.md`).

No es un sitio de marketing extenso. Es una sola página, sobria,
extremadamente rápida. Referencia de estructura/tono (NO de copia ni de
estética):
[wyloapp.com](https://www.wyloapp.com/) — pero **más simple**.

## Mapa de los documentos

| Archivo                          | Qué responde                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `README.md` (este)               | Objetivo, presupuesto de performance, dónde buscar cada cosa, decisiones abiertas |
| [`architecture.md`](./architecture.md) | Dónde vive la landing en el repo, ruteo apex, estrategia de rendering (SSG/RSC), boundaries, data |
| [`styles.md`](./styles.md)       | Sistema visual: tipografía, color (CSS vars), escala, espaciado, componentes, tokens |
| [`content.md`](./content.md)     | Estructura de secciones + copy placeholder en español, marcas `[A DEFINIR]`   |

**Si en el futuro hay que modificar la landing, buscá acá primero:**

- ¿Cambia el copy / agregar-quitar una sección? → `content.md` + la
  sección correspondiente del componente (ver `architecture.md` §
  "Estructura de archivos propuesta").
- ¿Cambia un color / tipografía / espaciado? → `styles.md` (y los
  tokens de `globals.css`; la landing NO inventa tokens propios).
- ¿Cambia dónde vive / cómo se rutea / regresión de performance? →
  `architecture.md`.
- ¿Cambia el destino del CTA / el flujo de registro? →
  `docs/rls/place-access.md` + `docs/features/auth/spec.md`
  (la landing solo linkea, no implementa el flujo).

## Presupuesto de performance (objetivo duro: < 200ms)

El requisito del owner es **carga < 200ms** entendida como **TTFB +
render del shell** (el documento usable y pintado, no necesariamente todos
los assets hidratados). Esto **condiciona la arquitectura**: ver
`architecture.md` § "Estrategia de rendering" para el CÓMO. Acá va el
QUÉ se mide y el budget.

### Qué se mide

| Métrica                         | Objetivo            | Cómo se mide                                                                 |
| ------------------------------- | ------------------- | ---------------------------------------------------------------------------- |
| TTFB (apex, página fría)        | < 50ms desde CDN    | Vercel Analytics / `curl -w "%{time_starttransfer}"` contra prod             |
| TTFB + HTML shell render        | **< 200ms**         | WebPageTest / Lighthouse "Speed Index" en perfil cable; budget duro          |
| FCP                             | < 250ms             | Lighthouse (CI con `@lhci/cli`, ver más abajo)                               |
| LCP                             | < 800ms             | Lighthouse — el LCP candidato es el `<h1>` del hero (texto, no imagen)       |
| CLS                             | 0                   | Lighthouse — cero layout shift: dimensiones explícitas en toda imagen        |
| TBT / JS de cliente             | ~0ms                | La landing es 100% Server Component estático; CERO JS de cliente propio      |

### Budget de bytes / requests (página fría, sin caché)

| Recurso                    | Budget                | Nota                                                                          |
| -------------------------- | --------------------- | ----------------------------------------------------------------------------- |
| HTML (gzip/brotli)         | ≤ 14 KB               | Cabe en la primera ventana de congestión TCP → 1 RTT. Crítico para el <200ms. |
| CSS                        | ≤ 12 KB (gzip)        | Tailwind con `content` bien acotado + globals.css. Sin CSS de features.       |
| Fuentes                    | ≤ 2 archivos, ≤ 60 KB | Inter + Fraunces ya self-hosted vía `next/font` (subsetting latin). Reusa el `next/font` del root layout — cero fuentes nuevas. |
| Imágenes                   | ≤ 1, lazy salvo hero  | Si hay hero image: `next/image`, AVIF/WebP, `priority`, dimensiones explícitas. Preferir NO tener hero image (texto > imagen). |
| JS de cliente (first load) | ≤ framework runtime   | Sin componentes `'use client'` propios. Solo el runtime mínimo de Next que igual se carga; idealmente `next/script` ausente. |
| Requests totales (cold)    | ≤ 5                   | HTML + CSS + ≤2 fuentes + (opcional) 1 imagen. Sin terceros, sin analytics-blocking, sin web fonts externas. |

### Cómo se protege en CI (recomendado, ver decisión D5)

- **Lighthouse CI** (`@lhci/cli`) con budget en
  `lighthouse-budget.json`: falla el PR si HTML > 14 KB, CLS > 0, o
  Performance score < 99.
- **`@next/bundle-analyzer`** ya está configurado (`next.config.ts`,
  `ANALYZE=true`). La ruta de la landing debe aparecer con **0 KB de
  First Load JS propio** (solo el shared runtime de Next).
- Estos gates son una propuesta; activarlos requiere decisión del owner
  (D5) porque toca CI.

## Decisiones abiertas

> Marcadas para resolver con el owner antes de implementar. No las
> resuelve el dev en una sesión de código (regla CLAUDE.md).

- **D1 — Dominio apex de producción.** El task y el `EMAIL_FROM` de
  `.env.local` usan `place.community`. Los docs (`multi-tenancy.md`,
  `host.ts`, `places/spec.md`) usan `place.app` como placeholder. El
  middleware NO hardcodea el apex: lee `NEXT_PUBLIC_APP_DOMAIN` (env). La
  landing no necesita saber el apex literal (es relativa). **[A DEFINIR
  con owner]:** confirmar `place.community` como apex canónico y
  actualizar los docs que dicen `place.app` (trabajo aparte, no bloquea
  esta spec).
- **D2 — Hero image: sí o no.** El budget favorece *no* tener imagen
  (texto LCP < imagen LCP, y ahorra 1 request). `content.md` propone hero
  tipográfico. **[A DEFINIR con owner]:** ¿se quiere una imagen/ilustración
  de marca en el hero? Si sí, define presupuesto y arte.
- **D3 — Copy real.** Todo el copy de `content.md` es placeholder en
  español coherente con blueprint. Los claims están limitados a lo que
  existe en `blueprint.md`/`CLAUDE.md`. **[A DEFINIR con owner]:** copy
  final, nombre de marca exacto, tagline.
- **D4 — CTA único vs. dos CTAs.** Propuesta: un solo CTA "Entrar"
  → `/login` (el onboarding post-login bifurca crear/unirse/invitación,
  ver `place-access.md`). **[A DEFINIR con owner]:** ¿se quiere además un
  CTA secundario explícito tipo "Crear un place"? (sigue yendo a
  `/login` con `?next=`).
- **D5 — Gates de performance en CI.** Activar Lighthouse CI + budget
  toca configuración de CI. **[A DEFINIR con owner]:** aprobar el gate
  (recomendado) o dejar el budget como guía no-bloqueante.
- **D6 — Legales / footer.** ¿Hay Términos / Privacidad / contacto que
  deban linkearse en el footer? Place no es red social y no recolecta
  métricas, pero igual puede necesitar legales mínimos. **[A DEFINIR con
  owner]:** qué links del footer existen y a dónde apuntan.
</content>
</invoke>
