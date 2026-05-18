// 404 de la zona `(app)`: lo dispara la page de place cuando el slug no es
// servible (reservado/formato inválido — gate estructural S7) y, desde S5b,
// cuando el place no existe en DB. Español (zona producto, CLAUDE.md); sin
// i18n de URL (eso es marketing). Sin dependencia del slice landing (regla de
// aislamiento: `(app)` no importa de `features/`).
export default function AppNotFound() {
  return (
    <main
      id="contenido"
      className="flex min-h-screen flex-col items-center justify-center px-6 text-center"
    >
      <h1 className="text-4xl text-ink">Lugar no encontrado</h1>
      <p className="mt-4 max-w-md leading-relaxed text-muted">
        No existe ningún lugar en esta dirección.
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
