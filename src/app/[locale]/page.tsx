import { setRequestLocale } from "next-intl/server";
import { LandingPage } from "@/features/landing/public";

type Props = { params: Promise<{ locale: string }> };

export default async function Page({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LandingPage />;
}
