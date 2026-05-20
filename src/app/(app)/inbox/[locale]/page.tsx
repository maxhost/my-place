// Inbox universal del usuario — servible en `app.place.community/{locale}/`
// (`docs/multi-tenancy.md`). El proxy reescribe ese host a `/inbox/{locale}/`
// (S5a del Hub: composición intl + rewrite, `src/proxy.ts`).
//
// PLACEHOLDER: la implementación real (auth guard + `getInboxPayload` +
// render `NavHubLayout` + `PlacesView`) viene en S5b del Hub. Este archivo
// se movió en S5a desde `(app)/inbox/page.tsx` al sub-árbol `[locale]/` (i18n
// del Hub, spec §"Estructura de routes") y se reemplaza completo en S5b.

// Co-location Neon ↔ Functions (`docs/architecture.md` §Performance ·
// `docs/stack.md` §Región): la zona app es DB-bound desde S5b.
export const preferredRegion = "iad1";

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function InboxPage({ params }: Props) {
  const { locale } = await params;
  return (
    <main
      id="contenido"
      className="flex min-h-screen flex-col items-center justify-center px-6 text-center"
    >
      <p className="text-sm uppercase tracking-widest text-muted">
        inbox · {locale}
      </p>
      <h1 className="mt-3 text-3xl text-ink">Tu espacio</h1>
      <p className="mt-4 max-w-md leading-relaxed text-muted">
        Acá vas a ver tus mensajes y los lugares a los que pertenecés.
      </p>
    </main>
  );
}
