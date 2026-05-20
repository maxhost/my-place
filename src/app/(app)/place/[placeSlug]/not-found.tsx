// 404 de la zona Place: lo dispara la page del place cuando el slug no es
// servible (reservado/formato inválido — gate estructural S7) y, desde S5b,
// cuando el place no existe en DB. Movido en S5a del Hub desde
// `(app)/not-found.tsx` al sub-árbol `place/[placeSlug]/` (restructure
// multi-root: el layout `(app)/` se eliminó, cada sub-grupo provee su
// `<html>` y su 404 propio).
export default function PlaceNotFound() {
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
