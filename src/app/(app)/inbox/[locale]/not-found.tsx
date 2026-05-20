// 404 de la zona Hub (S5a del Hub V1, `docs/features/inbox/spec.md`
// §"Estructura de routes"). Lo dispara Next cuando el segmento `[locale]`
// no es un locale válido (`routing.locales.includes` falla en el layout) o
// cuando una sub-vista futura del Hub no existe (`/dms`, `/actividad`).
// Español (zona producto, CLAUDE.md); sin i18n runtime (locale podría ser
// inválido). Sin dependencia del slice landing — aislamiento `(app)`.
export default function InboxNotFound() {
  return (
    <main
      id="contenido"
      className="flex min-h-screen flex-col items-center justify-center px-6 text-center"
    >
      <h1 className="text-4xl text-ink">Esta sección no existe</h1>
      <p className="mt-4 max-w-md leading-relaxed text-muted">
        La vista que buscás todavía no está disponible en tu espacio.
      </p>
      <a
        href="https://place.community"
        className="cta mt-8 inline-flex min-h-[3rem] items-center justify-center rounded-lg px-7 text-base font-medium"
      >
        Ir a Place
      </a>
    </main>
  );
}
