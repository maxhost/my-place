"use client";

import { type FormEvent, useId, useRef, useState } from "react";
import { type PlaceLocale, PLACE_LOCALES } from "@/features/place/public";
import type {
  UpdateDefaultLocale,
  UpdateDefaultLocaleResult,
} from "../actions/update-default-locale";

// Sección "Idioma del place" del settings (S7 feature `settings`,
// `docs/features/settings/spec.md` §"Sección Idioma del place"). Client
// Component: máquina del form + UI + idempotencia ref + diff dirty/pristine.
//
// Decisiones de diseño:
//
// - **Labels inline** (vs `locale-section-labels.ts` separado): el slice es
//   chico y el form de una sola superficie (select + botón); separar el
//   interface a un archivo aparte sumaría 1 archivo sin valor — manteniendo
//   el split inline el slice cumple el límite del plan (5 archivos S7) y la
//   regla CLAUDE.md ≤300 LOC del componente. Si en V2 entra "Apariencia"
//   también acá, se reevalúa el extract a archivo aparte.
// - **`updateAction` como prop** (no import directo del action): seam-split
//   canónico — los tests inyectan `vi.fn()`, el page del settings (S6) inyecta
//   `updateDefaultLocaleAction`. Mismo patrón que `<AccessFlow>` con `auth`
//   (`access-flow.tsx:33`) y `<PlaceWizard>` con `onSubmit`.
// - **Diff dirty/pristine contra `savedLocale`** (no contra `currentLocale`):
//   tras success el `savedLocale` se actualiza al valor recién persistido —
//   sin esto, el botón "Guardar" quedaría enabled aunque ya no hay diff que
//   guardar (`currentLocale` viene de la prop, snapshot del SSR previo a
//   `revalidatePath`). Misma mecánica que un controlled form con baseline
//   local post-submit.
// - **Idempotencia por ref** (mismo patrón que `useAccessForm` y el wizard,
//   `feedback_loading_states_validate_with_real_data` + tests pre-existentes):
//   el ref bloquea reentradas aunque el state no haya re-renderizado todavía
//   (doble click ultra-rápido); el `setSubmitting(true)` es la señal UX.
// - **`{language}` placeholder en `successBody`**: misma convención que
//   `wizard.successBody` con `{url}` (`wizard-success.tsx:20`) y `wizard.terms`
//   con `{terms}`/`{privacy}` (`access-flow.tsx:55`). Resolución client-side
//   con `.replace` desde `labels.options[savedLocale]` (endonym del nuevo
//   locale).

export interface LocaleSectionLabels {
  /** Encabezado de la sección. */
  title: string;
  /** Texto descriptivo bajo el título. */
  description: string;
  /** Label del `<select>`. */
  label: string;
  /**
   * Endonyms de los 6 locales operativos (ADR-0024). El page los carga desde
   * `placeSettings.language.options.*` del namespace i18n del place. Mapeado
   * `Record<PlaceLocale, string>` para garantizar tipo-cierre (no se puede
   * pasar un mapa parcial).
   */
  options: Record<PlaceLocale, string>;
  /** Botón de submit en pristine/dirty. */
  save: string;
  /** Botón de submit durante el submit pendiente. */
  saving: string;
  /** Título del aviso post-success ("Idioma actualizado."). */
  successTitle: string;
  /**
   * Cuerpo del aviso post-success — template con `{language}` (sin namespace,
   * convención del slice). El componente lo reemplaza con el endonym del
   * locale guardado.
   */
  successBody: string;
  /** Aviso ante cualquier fallo del action (mapeado UX-equivalente, spec). */
  errorNotice: string;
}

type NoticeState = "ok" | "error" | null;

const fieldClass =
  "min-h-[2.75rem] rounded-lg border border-border bg-surface px-3 text-base text-ink disabled:opacity-60";
const noticeClass =
  "rounded-lg border border-border bg-surface px-4 py-3 text-sm text-ink";

export function LocaleSection({
  currentLocale,
  placeSlug,
  updateAction,
  labels,
}: {
  /** Locale persistido en DB (snapshot del último SSR del page). */
  currentLocale: PlaceLocale;
  /** Slug del place — se manda al action como segundo discriminante. */
  placeSlug: string;
  /** Server Action inyectada (seam-split). En tests es `vi.fn()`. */
  updateAction: UpdateDefaultLocale;
  /** Textos resueltos por el page desde `placeSettings.language.*`. */
  labels: LocaleSectionLabels;
}) {
  const selectId = useId();
  const [selected, setSelected] = useState<PlaceLocale>(currentLocale);
  // Snapshot del último valor confirmado por DB. Inicializado con la prop;
  // tras success se actualiza al nuevo locale. El diff `selected !== savedLocale`
  // = "hay cambios sin guardar" — fuente única del estado dirty/pristine.
  const [savedLocale, setSavedLocale] = useState<PlaceLocale>(currentLocale);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<NoticeState>(null);
  const submittingRef = useRef(false);

  const dirty = selected !== savedLocale;
  const canSubmit = dirty && !submitting;

  function handleChange(next: PlaceLocale) {
    setSelected(next);
    // Cualquier edición del select limpia el notice previo: el usuario está
    // por intentar de nuevo / con otro valor, el aviso anterior caducó.
    if (notice !== null) setNotice(null);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submittingRef.current || !canSubmit) return;
    submittingRef.current = true;
    setSubmitting(true);
    setNotice(null);
    let res: UpdateDefaultLocaleResult;
    try {
      res = await updateAction({ placeSlug, newLocale: selected });
    } catch {
      // El action no debería lanzar (mapea todo a `error`); si lo hace por un
      // path no previsto, lo tratamos UX-equivalente.
      res = { status: "error" };
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
    if (res.status === "ok") {
      setSavedLocale(selected);
      setNotice("ok");
    } else {
      setNotice("error");
    }
  }

  const successBody = labels.successBody.replace(
    "{language}",
    labels.options[savedLocale],
  );

  return (
    <section className="flex flex-1 flex-col gap-6 px-4 py-6 md:px-8 md:py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl text-ink">{labels.title}</h1>
        <p className="max-w-prose leading-relaxed text-muted">
          {labels.description}
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="flex max-w-md flex-col gap-4"
        aria-busy={submitting || undefined}
      >
        <div className="flex flex-col gap-2">
          <label htmlFor={selectId} className="text-sm font-medium text-ink">
            {labels.label}
          </label>
          <select
            id={selectId}
            value={selected}
            disabled={submitting}
            onChange={(e) => handleChange(e.target.value as PlaceLocale)}
            className={fieldClass}
          >
            {PLACE_LOCALES.map((loc) => (
              <option key={loc} value={loc}>
                {labels.options[loc]}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="cta inline-flex min-h-[2.75rem] items-center justify-center self-start rounded-lg px-6 text-base font-medium disabled:opacity-40"
        >
          {submitting ? labels.saving : labels.save}
        </button>

        {notice === "ok" && (
          <p role="status" aria-live="polite" className={noticeClass}>
            <strong>{labels.successTitle}</strong> {successBody}
          </p>
        )}
        {notice === "error" && (
          <p role="status" aria-live="polite" className={noticeClass}>
            {labels.errorNotice}
          </p>
        )}
      </form>
    </section>
  );
}
