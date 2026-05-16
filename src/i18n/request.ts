import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "./routing";

// Carga de mensajes por request. v1: solo es.json poblado; en/fr/pt caen al
// default (es) hasta que se traduzcan. La estructura ya está lista para sumar
// los catálogos sin tocar componentes.
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`./messages/${routing.defaultLocale}.json`))
      .default,
  };
});
