import { getTranslations } from "next-intl/server";
import { Container } from "./_ui";

// Sin testimonios (no hay usuarios todavía — input lockeado). Franja sobria,
// no compite con el CTA.
export async function FranjaPruebaSocial() {
  const t = await getTranslations("socialProof");
  return (
    <div className="border-y border-border py-8">
      <Container>
        <p className="text-center text-base text-muted">{t("text")}</p>
      </Container>
    </div>
  );
}
