// Interfaz pública del slice `member-profile` (extracción S10.8 ADR-0042
// desde `members/`). Cross-slice imports SÓLO via este barrel — regla
// ESLint ADR-0039 valida.
//
// Cohesión: capability autónoma del perfil contextual del miembro en este
// place (self-edit only, ADR-0036 §3). V1 expone: 1 Server Action +
// 1 Client Component + tipos (`HeadlineError`, `UpdateMyHeadlineInput`).
// Consumer principal: page S11 `/settings/members` que monta
// `<HeadlineEditor />` en la sección "Tu perfil en este place".
//
// Reserva V1.1+: avatar contextual + otros campos perfil-en-place se
// agregarán a este slice cuando se implementen. NO se exportan maps de
// errores ni zod schemas — internos.

export {
  updateMyHeadlineAction,
  type UpdateMyHeadlineResult,
} from "./actions/update-my-headline";
export type { UpdateMyHeadlineInput } from "./actions/_lib/schemas";
export type { HeadlineError } from "./types";
export {
  HeadlineEditor,
  type HeadlineEditorLabels,
} from "./ui/headline-editor";
