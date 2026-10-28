import { defineAuth } from "@aws-amplify/backend";
import { altaEstudiante } from "./alta-estudiante/resource.ts";

// Acceso con correo. Grupos:
// - estudiante: todos los usuarios (los añade alta-estudiante al confirmar la cuenta).
// - admin: se asigna a mano; crea conjuntos públicos y ve el progreso de todos.
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  groups: ["admin", "estudiante"],
  triggers: {
    postConfirmation: altaEstudiante,
  },
  access: (allow) => [allow.resource(altaEstudiante).to(["addUserToGroup"])],
});
