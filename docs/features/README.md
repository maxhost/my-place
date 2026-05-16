# Features · índice maestro

Inventario de todo lo que Place incluye o quiere incluir. Es el **backlog y mapa**, no el spec.

> _Última actualización: 2026-05-16._ Documento vivo. Compilado desde los docs canónicos (ontología, ADRs, stack) + lo que el owner bajó de la cabeza. No se taggea MVP por feature: **casi todo entra**; lo que es posterior se marca como `Roadmap`/`Parked` acá y la **landing** decide qué muestra como "futuro / próximamente".

**Convención de specs:** cada feature, cuando se va a construir, tiene `docs/features/<slug>/spec.md` (un archivo por feature; si crece, la carpeta admite anexos). Spec antes de código (ver `CLAUDE.md`). Este README los enlaza cuando existan.

**Estados:** `Core` = decidido, ontología/ADR cerrado · `Plataforma` = infra decidida · `Roadmap` = posterior, ya documentado · `Parked` = idea futura sin decidir · `TBD` = pieza técnica sin elegir.

---

## Zonas y objetos del core

| Feature | Qué es | Estado | Canónico |
|---|---|---|---|
| Discusiones | Zona Discusión + Discusión (primitivo, siempre activa). Lexical, citas, @menciones, lectores, temporadas | Core | `ontologia/conversaciones.md` |
| Eventos | Zona opcional. Evento = Discusión; único/recurrente, 3 momentos, ritual/acumulación, acceso role-aware | Core | `ontologia/eventos.md` |
| Biblioteca | Zona opcional. Categorías (general/curso), recursos = Discusión, dependencias/progreso | Core | `ontologia/library.md` |
| Miembros | Identidad 3 capas, perfil contextual, presencia silenciosa, handle | Core | `ontologia/miembros.md` |
| DMs | Inbox universal de mensajes directos, contexto del place donde se conocieron | Core | `ontologia/miembros.md` |
| Temporadas / anuario | Cierre de temporada → artefacto descargable (PDF/libro) | Core | `ontologia/conversaciones.md`, `eventos.md` |

## Plataforma / multi-tenancy

| Feature | Qué es | Estado | Canónico |
|---|---|---|---|
| Places | Crear/configurar place, slug inmutable, máx 150 | Plataforma | `data-model.md`, `multi-tenancy.md` |
| Place branding | Logo/icono del place + colores propios (theming) | Plataforma (depende de Storage TBD) | `producto.md` § identidad visual |
| Elegir zonas | El owner activa las que necesita: discusiones (siempre), eventos, biblioteca | Plataforma | `data-model.md`, `ontologia/*` |
| Multi-tenancy subdomain | `{slug}.place.community` + routing por hostname | Plataforma | `multi-tenancy.md` |
| Custom domains | Dominio propio del place vía Vercel API + OIDC client por dominio | Plataforma | `multi-tenancy.md`, ADR-0001 |
| Gate de horario | Place accesible solo en horario; owner exceptuado | Plataforma | `architecture.md` § Gate |
| Settings del owner | Activar/desactivar zonas, horario, theming, ownership | Plataforma | `data-model.md` |

## Auth e identidad

| Feature | Qué es | Estado | Canónico |
|---|---|---|---|
| Auth (Neon Auth/Better Auth) | OIDC IdP propio, SSO cross-domain | Plataforma | ADR-0001, `stack.md` |
| Onboarding | Alta de cuenta: nombre + avatar, handle auto random editable | Core | `ontologia/miembros.md` |
| Roles owner/miembro | Owner vs miembro; rol derivado | Core | ADR-0002, `data-model.md` |
| Lifecycle de cuenta | Inactividad 6m/12m, tombstone, derecho al olvido | Core | ADR-0003 |

## Billing y monetización

| Feature | Qué es | Estado | Canónico |
|---|---|---|---|
| Suscripción del owner | Pago mensual del place; lifecycle pago-pendiente→inactivo→purga | Core (mecanismo TBD) | ADR-0003 |
| Tiers de miembro | Monetización de la comunidad: accesos pagados por tier | Roadmap (schema diferido) | ADR-0003 |
| Planes de plataforma | **Dos planes**: Comunidad (sin/baja comisión — "lo que cobrás es tuyo") y Hobbie (más barato, Place toma comisión para cubrir costos). Modelo = suscripción + comisión por plan. **Precio y % sin decidir.** Extiende ADR-0003 | Decidido en estructura, números TBD | (ADR cuando se fijen números) |
| Pagos (proveedores) | Multi-proveedor: Stripe, PayPal, MercadoPago | TBD (proveedores conocidos) | `stack.md` |

## Transversal / experiencia

| Feature | Qué es | Estado | Canónico |
|---|---|---|---|
| i18n | Estático multi-idioma; ES day-one, EN/FR/PT roadmap | Core (ES) / Roadmap (resto) | `producto.md`, `stack.md` |
| Reconocimiento de pertenencia | Antigüedad, hitos, insignias cualitativas; sin vanidad/FOMO | Core | ADR-0002, `producto.md` |
| Moderación | Centralizada en owner | Core | `ontologia/conversaciones.md` |
| @menciones | A usuarios, recursos de biblioteca, eventos (permission-gated) | Core | `ontologia/conversaciones.md` |
| Reacciones emoji | Expresión, no jerarquía | Core | `ontologia/conversaciones.md` |
| Editor Lexical | Rich text profesional (negritas, listas, enlaces) | Core | `ontologia/conversaciones.md` |
| Embeds de medios externos | Incrustar YouTube, Vimeo, Apple Podcasts, iVoox, Spotify, Google Drive, Dropbox, PDF en mensajes y recursos. **Todos parte del MVP** | Core | (spec propio cuando se construya) |

## Roadmap / parked (posterior)

| Feature | Qué es | Estado | Canónico |
|---|---|---|---|
| Grupos con permisos granulares | Owner crea grupos; recrea "admin" como grupo; gestión por grupos | Roadmap | ADR-0002 |
| Add-ons / extensibilidad | Ampliar el funcionamiento del place con add-ons | Parked | — (nuevo) |
| Gestión multi-place centralizada | Dashboard para un owner que maneja varios places | Parked | — (nuevo) |
| Eventos con pago / ticketing | Cobrar por un evento puntual | Parked | `ontologia/eventos.md` |
| Sala de video integrada | Hoy se usa Zoom/Meet/Discord externo | Parked | `ontologia/eventos.md` |
| Invitaciones a no-miembros | Externos a un evento puntual | Parked | `ontologia/eventos.md` |
| Integración calendario externo | Google/Apple Calendar | Parked | `ontologia/eventos.md` |
| Audio efímero en discusiones | Audios 24h + transcripción (sacado del core) | Parked | — |
| Push notifications | Requiere decisión de producto | Parked | `producto.md` |
| Realtime | Si aparece el caso de uso | TBD | `stack.md` |
| Storage | Avatares/assets del place | TBD | `stack.md` |
| Acceso a datos (ORM/driver) | Método de acceso a Neon | TBD | `stack.md` |

---

## Capacidades del miembro

El miembro no tiene zonas propias: participa en las del place según su acceso. Participar en discusiones · participar en eventos · publicar/consumir recursos de biblioteca. Todo permission-gated por la config de cada zona/categoría.

## Principios que el owner reafirmó (ya canónicos, no son features)

- El corazón de la plataforma son las discusiones/conversaciones → `ontologia/conversaciones.md` (Discusión = primitivo).
- Sin FOMO para los miembros → `producto.md` + ADR-0002.
- Gamificación centrada en la comunidad, no en la audiencia → ADR-0002.

## Decisión registrada, pendiente de números

**Planes de plataforma:** estructura decidida (2 planes: Comunidad / Hobbie; suscripción + comisión por plan). Falta: precio de cada plan, % de comisión exacto, si la comisión es *además de* o *en vez de* la suscripción, qué incluye cada uno. Cuando se decidan los números → **ADR-0004 + `docs/pricing.md`** y se actualiza ADR-0003 (que hoy solo cubre la suscripción del owner sin comisión por plan).
