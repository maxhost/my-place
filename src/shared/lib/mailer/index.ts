/**
 * Public surface del módulo mailer. Los callers de feature importan solo desde
 * acá — nunca reach-into files internos.
 */
export type { Mailer, InvitationEmailInput, SendResult } from './types'
export { getMailer, setMailer, resetMailer } from './provider'
export { FakeMailer } from './fake-mailer'
