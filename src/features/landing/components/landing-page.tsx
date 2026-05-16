import { Nav } from "./nav";
import { Hero } from "./hero";
import { Problema } from "./problema";
import { ComoFunciona } from "./como-funciona";
import { Diferenciacion } from "./diferenciacion";
import { ParaQuien } from "./para-quien";
import { FranjaPruebaSocial } from "./franja-prueba-social";
import { Pricing } from "./pricing";
import { Faq } from "./faq";
import { CtaFinal } from "./cta-final";
import { Footer } from "./footer";

// Composición de la landing en el orden de alta conversión del README
// §Estructura de secciones. Todo Server Component → 0 KB First Load JS propio.
export function LandingPage() {
  return (
    <>
      <Nav />
      <main id="contenido">
        <Hero />
        <Problema />
        <ComoFunciona />
        <Diferenciacion />
        <ParaQuien />
        <FranjaPruebaSocial />
        <Pricing />
        <Faq />
        <CtaFinal />
      </main>
      <Footer />
    </>
  );
}
