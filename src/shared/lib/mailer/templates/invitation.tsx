import type { InvitationEmailInput } from '../types'

/**
 * Template de invitación. JSX plano con inline styles (requerido por clientes
 * de email — GMail, Outlook, Apple Mail — que ignoran `<style>` y clases CSS
 * externas). Sin `@react-email/components`: el paquete está deprecado y el
 * template es suficientemente simple para escribirlo a mano.
 *
 * Copy deliberadamente breve y humano: alineado con el tono Place — "entrar
 * a un pub conocido, no a una red social". Sin CTAs gritones, sin emojis,
 * sin tracking pixels, sin marketing fillers.
 *
 * Resend SDK acepta `react: <Element>` y llama internamente a
 * `@react-email/render` para producir HTML optimizado para email clients
 * (inlining adicional, normalización). Para tests renderizamos con
 * `renderInvitationHtml` directamente.
 */

const wrapper: React.CSSProperties = {
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
  backgroundColor: '#f7f5f2',
  padding: '40px 20px',
  color: '#1a1a1a',
}

const card: React.CSSProperties = {
  maxWidth: '540px',
  margin: '0 auto',
  backgroundColor: '#ffffff',
  padding: '32px',
  borderRadius: '8px',
  border: '1px solid #e7e4de',
}

const heading: React.CSSProperties = {
  fontFamily: "'Playfair Display', Georgia, serif",
  fontStyle: 'italic',
  fontSize: '22px',
  fontWeight: 400,
  margin: '0 0 20px',
  color: '#1a1a1a',
}

const paragraph: React.CSSProperties = {
  fontSize: '15px',
  lineHeight: 1.6,
  margin: '0 0 16px',
}

const button: React.CSSProperties = {
  display: 'inline-block',
  backgroundColor: '#1a1a1a',
  color: '#ffffff',
  padding: '12px 24px',
  borderRadius: '6px',
  textDecoration: 'none',
  fontSize: '15px',
  margin: '8px 0 24px',
}

const linkFallback: React.CSSProperties = {
  fontSize: '12px',
  color: '#666666',
  wordBreak: 'break-all',
  margin: '0 0 24px',
}

const footer: React.CSSProperties = {
  fontSize: '12px',
  color: '#999999',
  marginTop: '32px',
  borderTop: '1px solid #e7e4de',
  paddingTop: '16px',
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'long',
  }).format(date)
}

export function InvitationEmail({
  placeName,
  inviterDisplayName,
  inviteUrl,
  expiresAt,
}: InvitationEmailInput) {
  return (
    <html lang="es">
      {/* Email HTML: `<head>` acá es elemento de documento, no de Next page —
          la regla @next/next/no-head-element no aplica (no hay routing de Next). */}
      {/* eslint-disable-next-line @next/next/no-head-element */}
      <head>
        <meta charSet="utf-8" />
        <title>Invitación a {placeName}</title>
      </head>
      <body style={wrapper}>
        <div style={card}>
          <h1 style={heading}>Te invitaron a {placeName}</h1>
          <p style={paragraph}>
            {inviterDisplayName} te abrió la puerta a <strong>{placeName}</strong>.
          </p>
          <p style={paragraph}>
            Es un lugar pequeño — un pub conocido, no una red social. Entrás, te ponés al día de lo
            que pasa, participás si querés, y salís.
          </p>
          <a href={inviteUrl} style={button}>
            Entrar a {placeName}
          </a>
          <p style={linkFallback}>
            Si el botón no funciona, copiá este link:
            <br />
            {inviteUrl}
          </p>
          <p style={paragraph}>
            El link vence el {formatDate(expiresAt)}. Si no lo pediste, ignoralo — no pasa nada.
          </p>
          <p style={footer}>Place · {placeName}</p>
        </div>
      </body>
    </html>
  )
}

/**
 * Versión plaintext obligatoria para deliverability (los filtros de spam
 * penalizan emails HTML-only). Se envía junto con la HTML como `text/plain`
 * alternate.
 */
export function renderInvitationPlaintext(input: InvitationEmailInput): string {
  return [
    `Te invitaron a ${input.placeName}`,
    ``,
    `${input.inviterDisplayName} te abrió la puerta a ${input.placeName}.`,
    ``,
    `Es un lugar pequeño — un pub conocido, no una red social. Entrás,`,
    `te ponés al día de lo que pasa, participás si querés, y salís.`,
    ``,
    `Entrar a ${input.placeName}:`,
    input.inviteUrl,
    ``,
    `El link vence el ${formatDate(input.expiresAt)}. Si no lo pediste,`,
    `ignoralo — no pasa nada.`,
    ``,
    `—`,
    `Place · ${input.placeName}`,
  ].join('\n')
}

export function renderInvitationSubject(input: InvitationEmailInput): string {
  return `${input.inviterDisplayName} te invitó a ${input.placeName}`
}
