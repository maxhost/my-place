import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { LegalPage } from "@/features/landing/public";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({
  params,
}: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "legal.privacidad" });
  return { title: `${t("title")} — Place` };
}

export default async function PrivacidadPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LegalPage doc="privacidad" />;
}
