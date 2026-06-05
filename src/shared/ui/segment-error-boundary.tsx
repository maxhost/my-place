"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

// Error boundary per-segment (Phase 2.H.2). A diferencia de `global-error.tsx`
// (ADR-0047) que reemplaza `<html>/<body>` cuando rompe el root layout, este
// primitive renderiza DENTRO del layout vivo: el shell + sidebar
// (`NavPlaceLayout`) siguen pintados y SÓLO el contenido streameado se
// reemplaza por este fallback cuando el async server child bajo `<Suspense>`
// tira (ej. DB error en `<MembersContent>` / `<DomainContent>`). Por eso usa
// el DS (Tailwind layout + tokens CSS) en vez de inline styles.
//
// **Copy hardcodeado en español** (no i18n): un error boundary es Client
// Component y el repo NO tiene `NextIntlClientProvider`/`useTranslations`
// client (todo i18n es server-side serializado a props, ADR-0024). El child
// que tiró no puede pasarle labels. Mismo trade-off que `global-error.tsx`.
//
// Reporte a Sentry vía `useEffect` (patrón canónico ADR-0047): post-hydration,
// sin bloquear el render del fallback. El SDK ya wrappea RSC/Server Action
// errors vía `onRequestError`; este boundary cubre el caso en que el throw
// escapa al render del segment.
//
// `shared/ui/` no importa de `features/` (regla del paradigma): este primitive
// es genérico, los `error.tsx` de cada segment lo re-exportan thin.

export type SegmentErrorBoundaryProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export function SegmentErrorBoundary({
  error,
  reset,
}: SegmentErrorBoundaryProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <section
      role="alert"
      className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center md:px-8"
    >
      <div className="flex max-w-md flex-col items-center gap-2">
        <h2 className="text-lg font-semibold text-ink">Algo salió mal</h2>
        <p className="text-sm text-muted">
          Tuvimos un problema cargando esta sección. Ya estamos al tanto.
        </p>
      </div>
      <button
        type="button"
        onClick={() => reset()}
        className="cta inline-flex min-h-[2.5rem] items-center justify-center rounded-lg px-5 text-sm font-medium"
      >
        Reintentar
      </button>
    </section>
  );
}
