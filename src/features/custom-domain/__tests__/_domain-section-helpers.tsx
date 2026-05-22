import { render } from "@testing-library/react";
import { vi } from "vitest";
import type { ArchiveCustomDomain } from "../actions/archive-custom-domain";
import type { RegisterCustomDomain } from "../actions/register-custom-domain";
import type {
  CustomDomainRecord,
  CustomDomainState,
} from "../types/custom-domain";
import {
  DomainSection,
  type DomainSectionLabels,
} from "../ui/domain-section";

// Helpers compartidos por los 2 archivos de tests del `<DomainSection>`:
//   - `domain-section.test.tsx` (render + submit + validación)
//   - `domain-section-interactions.test.tsx` (dialog + clipboard + timers
//     + idempotencia)
//
// Extraído acá para mantener cada archivo de tests ≤300 LOC (CLAUDE.md
// §"Límites de tamaño"). El prefijo `_` evita que vitest lo trate como
// suite (matchea `*.test.tsx`).

export const LABELS: DomainSectionLabels = {
  title: "Dominio",
  description: "Vinculá tu dominio propio.",
  inputLabel: "Tu dominio",
  inputPlaceholder: "comunidad.mi-marca.com",
  submitButton: "Vincular dominio",
  submitting: "Vinculando…",
  pendingTitle: "Verificando configuración DNS",
  pendingDescription: "Pegá los registros en tu provider de DNS para {domain}.",
  downrevertedBannerTitle: "Tu dominio dejó de funcionar",
  downrevertedBannerBody:
    "Detectamos que el DNS de {domain} ya no apunta a Place.",
  pendingSlaCopy: "La propagación puede tardar entre minutos y horas.",
  pendingVercelUnavailable:
    "Estamos verificando con Vercel, intentamos de nuevo en breve.",
  dnsRecordsTitle: "Registros DNS",
  dnsRecordType: "Tipo",
  dnsRecordName: "Nombre",
  dnsRecordValue: "Valor",
  copyButton: "Copiar",
  copiedTooltip: "¡Copiado!",
  verifiedBadge: "Verificado, SSL activo",
  verifiedDescription: "Tu dominio está listo y con SSL emitido.",
  archiveButton: "Remover",
  archiveConfirmTitle: "Remover dominio",
  archiveConfirmBody:
    "Tu place sigue disponible en {slug}.place.community. ¿Continuar?",
  archiveConfirmYes: "Sí, remover",
  archiveConfirmNo: "Cancelar",
  archiving: "Removiendo…",
  errorInvalidDomain: "Dominio inválido.",
  errorReserved: "Ese dominio está reservado.",
  errorIdnNotSupported: "Por ahora aceptamos solo dominios ASCII.",
  errorDomainTaken: "Ese dominio ya está vinculado a otro lugar de Place.",
  errorLimitReached: "Tu place ya tiene un dominio vinculado.",
  errorVercelUnavailable:
    "No pudimos contactar a Vercel. Probá de nuevo en un momento.",
  errorGeneric: "Algo salió mal. Probá de nuevo.",
  errorArchiveNotFound: "No encontramos ese dominio.",
  errorArchiveGeneric: "No pudimos remover el dominio. Probá de nuevo.",
};

export function makeRegister(
  over?: Awaited<ReturnType<RegisterCustomDomain>> | (() => Promise<Awaited<ReturnType<RegisterCustomDomain>>>),
): ReturnType<typeof vi.fn<RegisterCustomDomain>> {
  if (typeof over === "function") {
    return vi.fn<RegisterCustomDomain>(over);
  }
  const result =
    over ??
    ({
      status: "ok" as const,
      record: makeRecord(),
      dnsRecords: [],
    });
  return vi.fn<RegisterCustomDomain>(async () => result);
}

export function makeArchive(
  over?: Awaited<ReturnType<ArchiveCustomDomain>> | (() => Promise<Awaited<ReturnType<ArchiveCustomDomain>>>),
): ReturnType<typeof vi.fn<ArchiveCustomDomain>> {
  if (typeof over === "function") {
    return vi.fn<ArchiveCustomDomain>(over);
  }
  const result = over ?? ({ status: "ok" as const });
  return vi.fn<ArchiveCustomDomain>(async () => result);
}

export function makeRecord(
  over: Partial<CustomDomainRecord> = {},
): CustomDomainRecord {
  return {
    id: over.id ?? "dom_1",
    domain: over.domain ?? "comunidad.mi-marca.com",
    verifiedAt: over.verifiedAt ?? null,
    createdAt: over.createdAt ?? new Date("2026-05-01T00:00:00.000Z"),
  };
}

export function setup(opts: {
  state: CustomDomainState;
  placeSlug?: string;
  registerAction?: ReturnType<typeof makeRegister>;
  archiveAction?: ReturnType<typeof makeArchive>;
  onRefresh?: () => void;
}) {
  const registerAction = opts.registerAction ?? makeRegister();
  const archiveAction = opts.archiveAction ?? makeArchive();
  // Default `onRefresh = () => {}`: el componente usa `useRouter().refresh()`
  // si la prop es undefined; en jsdom (sin App Router montado) eso crashea.
  // Inyectar el no-op silencia el default sin afectar los tests que SÍ miden
  // el callback (esos pasan su propio `vi.fn()`).
  const onRefresh = opts.onRefresh ?? (() => {});
  const utils = render(
    <DomainSection
      state={opts.state}
      placeSlug={opts.placeSlug ?? "mi-club"}
      registerAction={registerAction}
      archiveAction={archiveAction}
      labels={LABELS}
      onRefresh={onRefresh}
    />,
  );
  return { ...utils, registerAction, archiveAction };
}

/**
 * Stub `navigator.clipboard` con writeText `vi.fn()`. Llamar en `beforeEach`.
 *
 * jsdom no expone `navigator.clipboard` por default; lo definimos como
 * `configurable: true` para poder espiarlo por test sin contaminar otros.
 */
export function stubClipboard() {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn(async () => undefined) },
    configurable: true,
    writable: true,
  });
}

/**
 * Limpia el stub de `navigator.clipboard`. Llamar en `afterEach`.
 *
 * Reset explícito a `undefined`: el `configurable: true` deja un define
 * previo y evita filtrado entre tests si jsdom evoluciona el shim.
 */
export function resetClipboard() {
  Object.defineProperty(navigator, "clipboard", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}
