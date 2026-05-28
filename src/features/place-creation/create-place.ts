import type { ContrastAdjustment } from "@/shared/lib/contrast";
import { ensureAppUser } from "@/shared/lib/ensure-app-user";
import {
  OnboardingDomainError,
  type PlaceCreationArgs,
  buildPlaceCreation,
} from "./domain/build-place";
import type { CreatePlacePorts } from "./ports";

// Saga de creación de place (ADR-0005 §2/§4, ADR-0008, ADR-0012 §3/§4).
// Orquestación PURA: dominio (S5a) → identidad (puerto) → ensureAppUser (TX 1)
// → app.create_place (TX 2). Sin conocer el modo (place-first vs authed): el
// modo lo encarna QUÉ `acquireIdentity` inyecta el Server Action.

export type CreatePlaceResult =
  | {
      status: "created";
      placeId: string;
      slug: string;
      /** Avisos del guardrail de contraste a mostrar al owner (ADR-0005 §8). */
      adjustments: ContrastAdjustment[];
    }
  | { status: "slug_taken" }
  | { status: "invalid"; fields: string[]; message: string };

// `place.slug` UNIQUE (S1) = la verificación DURA de disponibilidad; viola
// con SQLSTATE 23505. El chequeo "en vivo" del wizard no es autoritativo.
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "23505"
  );
}

/**
 * Crea un place orquestando identidad → `app_user` → place. Payload inválido
 * NO crea cuenta. Falla de `app.create_place` (slug ocupado) deja la cuenta
 * creada ("cuenta sin place", ADR-0005 §4) — no es error fatal.
 */
export async function createPlace(
  raw: unknown,
  ports: CreatePlacePorts,
): Promise<CreatePlaceResult> {
  // 1. Dominio puro PRIMERO (S5a): si el payload es inválido ni se crea
  //    cuenta (no se llega al borde cross-system).
  let args: PlaceCreationArgs;
  try {
    args = buildPlaceCreation(raw);
  } catch (err) {
    if (err instanceof OnboardingDomainError) {
      return {
        status: "invalid",
        fields: err.fields,
        message: err.toUserMessage(),
      };
    }
    throw err;
  }

  // 2. Identidad (borde cross-system, ADR-0005 §2). Si falla `signUp` acá,
  //    no se creó nada y no se llega a la DB.
  const ident = await ports.acquireIdentity();

  // 3. TX 1 — ensureAppUser commitea en su PROPIA tx. Compartir tx con
  //    create_place haría que el rollback de slug-dup borre el `app_user`
  //    → violaría "falla create_place → cuenta+app_user queda" (ADR-0005 §4).
  //    Identidad = `claims.sub` VERIFICADO (lo que RLS lee), NO el user.id de
  //    la respuesta de signUp → si difirieran, `au_self` rechaza y luego
  //    `app.create_place` caería en P0002.
  await ports.runAuthedTx((sql, claims) =>
    ensureAppUser(sql, {
      authUserId: claims.sub,
      email: ident.email,
      displayName: ident.displayName,
    }),
  );

  // 4. TX 2 — `app.create_place` en tx SEPARADA. Sus 3 inserts son atómicos
  //    DENTRO de la función (ADR-0012 §3); si falla, sólo rollbackea esta tx.
  try {
    const placeId = await ports.runAuthedTx(async (sql) => {
      // Overload 6-arg de migration 0007 (S2a.1) — el 6º param es
      // `default_locale`. La signature 5-arg de migration 0002 queda intacta
      // como compatibility surface, pero el caller nuevo SIEMPRE invoca este.
      const rows = await sql(
        "SELECT app.create_place($1, $2, $3, $4::jsonb, $5::jsonb, $6) AS place_id",
        [
          args.slug,
          args.name,
          args.description,
          JSON.stringify(args.themeConfig),
          JSON.stringify(args.openingHours),
          args.defaultLocale,
        ],
      );
      return rows[0]?.place_id as string;
    });
    return {
      status: "created",
      placeId,
      slug: args.slug,
      adjustments: args.adjustments,
    };
  } catch (err) {
    // Slug ocupado: la cuenta ya quedó (TX 1 commiteada) → estado "creá tu
    // place", sin error fatal. Cualquier otro fallo propaga: la cuenta
    // persiste igual por construcción ("cuenta sin place").
    if (isUniqueViolation(err)) return { status: "slug_taken" };
    throw err;
  }
}
