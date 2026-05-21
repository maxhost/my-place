import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { logoutAction } from "@/features/nav-hub/public";
import {
  NavPlaceLayout,
  type NavPlaceLabels,
} from "@/features/nav-place/public";
import { isServiceableSlug } from "@/shared/lib/host-routing";
import {
  getPlaceForZone,
  getSessionTokenForZone,
} from "../_lib/get-place-for-zone";

// Page del settings — `{slug}.place.community/settings` (proxy reescribe a
// `/place/{slug}/settings`, `docs/multi-tenancy.md`). S6 del feature
// `settings` (`docs/features/settings/spec.md` §"Auth guard mechanism").
//
// Server Component que orquesta el seam-split del settings V1, paralelo al
// page del Hub (`(app)/inbox/[locale]/page.tsx`):
//
// 1. Gate estructural del slug (`isServiceableSlug`) — formato/reservados.
// 2. Guard sesión cross-subdomain (`getSessionTokenForZone()` — memoizado
//    junto al layout vía `React.cache()`). Sin sesión → redirect cross-
//    subdomain al login del apex. El locale del redirect = default canónico
//    (`es`) porque sin sesión no podemos saber el locale del place ni del
//    user; el login del apex negocia su propio locale (path-based) cuando
//    el flujo aterrice.
// 3. Carga del place vía `getPlaceForZone(placeSlug)` (también memoizado).
//    Sabemos que hay sesión por (2), así que `null` ⇒ no-owner (RLS) o slug
//    no existente o archivado → `notFound()` (la 404 de la zona-place se
//    sirve sin pistas de "no tenés permiso", spec §"Journeys C").
// 4. i18n DB-based: `getTranslations({locale: place.defaultLocale, namespace:
//    "placeSettings"})` toma el override de locale del place (ADR-0024,
//    patrón verificado en S1.5 — `docs/gotchas/i18n-locale-override-zona-
//    place.md`). El namespace `navHub` se reusa para los labels del frame
//    (logout, account menu, drawer toggle — mismo widget visual que el Hub,
//    DRY).
// 5. Render `<NavPlaceLayout>` con `activeSection="language"`. Children =
//    placeholder calmo (S7 mete el form + Server Action UPDATE).
//
// `dynamic = "force-dynamic"`: el guard depende de cookie + la query
// depende de claims del request — nada SSG-cacheable. `preferredRegion =
// "iad1"` por co-location con Neon (architecture.md §Performance,
// stack.md §Región).
//
// `onLogout`: `logoutAction.bind(null, place.defaultLocale)` cierra el
// primer argumento (`locale`) del Server Action para satisfacer la firma
// `() => Promise<LogoutResult>` que pide el shell. Tras logout exitoso el
// SDK redirige al login del apex con el locale del place — coherente con
// el chrome que estaba viendo el owner.

export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

type Props = {
  params: Promise<{ placeSlug: string }>;
};

export default async function PlaceSettingsPage({ params }: Props) {
  const { placeSlug } = await params;
  // (1) Gate estructural — slug servible (formato + no reservado). Antes que
  // cualquier I/O: si el slug es inválido, ningún owner real puede dueño-
  // arlo, así que es notFound() puro.
  if (!isServiceableSlug(placeSlug)) notFound();

  // (2) Guard sesión. `null` = no logueado → cross-subdomain a login del
  // apex. NO throw: ausencia de sesión es estado válido del flujo.
  const token = await getSessionTokenForZone();
  if (token === null) {
    redirect("https://place.community/es/login");
  }

  // (3) Carga del place. Memoizado con el layout: en este punto la query
  // ya corrió desde el `<html lang>` dinámico del layout — `getPlaceForZone`
  // retorna el resultado memoizado sin tocar Neon de nuevo.
  const place = await getPlaceForZone(placeSlug);
  if (place === null) notFound();

  // (4) i18n del settings — locale del place (DB-based, ADR-0024). Dos
  // namespaces: `placeSettings` (dominio: title + 6 items del sidebar) +
  // `navHub` (frame compartido: account menu + drawer toggle + logout, DRY
  // con el Hub).
  const tSettings = await getTranslations({
    locale: place.defaultLocale,
    namespace: "placeSettings",
  });
  const tNav = await getTranslations({
    locale: place.defaultLocale,
    namespace: "navHub",
  });

  const navPlaceLabels: NavPlaceLabels = {
    title: tSettings("title"),
    sidebarLanguage: tSettings("sidebar.language"),
    sidebarMembers: tSettings("sidebar.members"),
    sidebarAppearance: tSettings("sidebar.appearance"),
    sidebarHours: tSettings("sidebar.hours"),
    sidebarBilling: tSettings("sidebar.billing"),
    sidebarDomain: tSettings("sidebar.domain"),
    comingSoon: tSettings("sidebar.comingSoon"),
    openMenu: tNav("sidebarToggleOpen"),
    closeMenu: tNav("sidebarToggleClose"),
    accountMenuButton: tNav("accountMenuLabel"),
    accountMenuLogout: tNav("logout"),
    accountMenuLogoutPending: tNav("logoutConfirming"),
  };

  // (5) Render. `displayName=null` por ahora: la sección "Idioma" no
  // requiere identidad visible, y la query `loadPlaceBySlug` no la trae
  // (sería overhead). Si en V2 el avatar muestra iniciales reales, se
  // agrega un `userDisplayName` al payload — paralelo a `inbox` que sí lo
  // trae con la stored function.
  const onLogout = logoutAction.bind(null, place.defaultLocale);

  return (
    <NavPlaceLayout
      labels={navPlaceLabels}
      displayName={null}
      activeSection="language"
      onLogout={onLogout}
    >
      <main
        id="contenido"
        className="flex flex-1 flex-col gap-3 px-4 py-6 md:px-8 md:py-10"
      >
        <h1 className="text-2xl text-ink">{tSettings("language.title")}</h1>
        <p className="max-w-prose leading-relaxed text-muted">
          {tSettings("language.description")}
        </p>
      </main>
    </NavPlaceLayout>
  );
}
