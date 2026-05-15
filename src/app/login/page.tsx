import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-static";
export const revalidate = false;

export const metadata: Metadata = {
  title: "Entrar — Place",
};

export default function Login() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="font-serif text-3xl italic text-text">Place</h1>
        <p className="mt-4 text-base leading-relaxed text-muted">
          El acceso todavía no está disponible. Estamos preparando el lugar.
        </p>
        <Link href="/" className="mt-8 inline-block text-sm text-accent">
          Volver
        </Link>
      </div>
    </main>
  );
}
