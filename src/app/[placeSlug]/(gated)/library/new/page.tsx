import { redirect } from 'next/navigation'

/**
 * `/library/new` redirige al landing de la biblioteca. La creación de
 * items requiere categoría — el flow canónico es entrar a la categoría
 * y usar `/library/<categorySlug>/new`. Esta page existía como
 * placeholder F.1 mientras Lexical estaba deshabilitado.
 */
export default async function LibraryNewRedirectPage() {
  redirect('/library')
}
