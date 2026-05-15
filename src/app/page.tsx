import { Hero } from "./_landing/hero";
import { ValueProp } from "./_landing/value-prop";
import { HowItWorks } from "./_landing/how-it-works";
import { Cta } from "./_landing/cta";
import { Footer } from "./_landing/footer";

export const dynamic = "force-static";
export const revalidate = false;

export default function Home() {
  return (
    <main>
      <Hero />
      <ValueProp />
      <HowItWorks />
      <Cta />
      <Footer />
    </main>
  );
}
