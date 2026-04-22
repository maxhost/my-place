import type { Metadata } from 'next'
import { Fraunces, Inter } from 'next/font/google'
import { buildThemeVars } from '@/shared/config/theme'
import { Toaster } from '@/shared/ui/toaster'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-fraunces',
  style: ['normal', 'italic'],
})

export const metadata: Metadata = {
  title: 'Place',
  description: 'Un lugar digital pequeño e íntimo para hasta 150 personas.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${inter.variable} ${fraunces.variable}`} style={buildThemeVars()}>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  )
}
