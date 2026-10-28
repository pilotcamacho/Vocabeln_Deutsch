import { a, defineData, type ClientSchema } from "@aws-amplify/backend";

// Modelo de datos de docs/diseno_app.md («Modelo de datos»). Las palabras no están aquí:
// viajan con la aplicación en palabras.json y se citan por su palabraId permanente.

// Campo owner explícito (para los índices): el estudiante lo lee, pero no puede reasignarlo.
// En DynamoDB se guarda como «<sub>::<username>», aunque la API lo devuelve recortado («<sub>»);
// las consultas por índice tienen que usar el valor completo.
const propietario = () =>
  a.string().authorization((allow) => [
    allow.owner().to(["read", "delete"]),
    allow.group("admin").to(["read"]),
  ]);

// En los conjuntos, también lo leen los grupos de «lectores» (conjuntos públicos).
const propietarioConjunto = () =>
  a.string().authorization((allow) => [
    allow.owner().to(["read", "delete"]),
    allow.group("admin").to(["read"]),
    allow.groupsDefinedIn("lectores").to(["read"]),
  ]);

// Conjuntos: «lectores» = grupos que pueden leerlo. Público → ["estudiante"]; privado → vacío.
// Solo un admin puede rellenarlo, así un estudiante no puede publicar sus conjuntos.
const lectores = () =>
  a
    .string()
    .array()
    .authorization((allow) => [
      allow.group("admin"),
      allow.owner().to(["read"]),
      allow.groupsDefinedIn("lectores").to(["read"]),
    ]);

const schema = a.schema({
  // Los valores de un enum de GraphQL no admiten guiones: de_es = alemán → español.
  Direccion: a.enum(["de_es", "es_de"]),
  EstadoTarjeta: a.enum(["nueva", "aprendiendo", "repaso", "conocida", "aprendida", "retirada"]),
  ResultadoRepaso: a.enum(["fallo", "acierto"]),
  TipoRepaso: a.enum(["estudio", "marcado", "control"]),
  TipoConjunto: a.enum(["libro", "tema", "texto"]),

  // Uno por estudiante. El rol no se guarda aquí: lo dan los grupos de Cognito.
  Perfil: a
    .model({
      nombre: a.string(),
      nuevasPorDia: a.integer().default(15),
      retencionObjetivo: a.float().default(0.9),
      parametrosFsrs: a.json(), // vacío = parámetros genéricos de ts-fsrs
      conjuntoActivoId: a.id(),
      owner: propietario(),
    })
    .authorization((allow) => [allow.owner(), allow.group("admin").to(["read"])]),

  // Historial: solo se añade, nunca se modifica. El id es un uuid generado en el dispositivo,
  // así reenviar un lote tras un corte de red no duplica repasos.
  Repaso: a
    .model({
      palabraId: a.integer().required(),
      direccion: a.ref("Direccion").required(),
      fechaHora: a.datetime().required(),
      resultado: a.ref("ResultadoRepaso").required(),
      tipo: a.ref("TipoRepaso").required(),
      tiempoMs: a.integer(),
      diasDesdeAnterior: a.float(),
      rPrevista: a.float(), // probabilidad de recordar que estimaba FSRS
      versionAlgoritmo: a.string(),
      dispositivo: a.string(),
      owner: propietario(),
    })
    .secondaryIndexes((index) => [
      index("owner").sortKeys(["fechaHora"]).queryField("repasosPorFecha"),
    ])
    .authorization((allow) => [
      allow.owner().to(["create", "read"]),
      allow.group("admin").to(["read"]),
    ]),

  // Estado actual por estudiante, palabra y dirección; se recalcula desde Repaso.
  // id = «<sub de Cognito>_<palabraId>_<direccion>», para que cada tarjeta tenga un id fijo.
  Tarjeta: a
    .model({
      palabraId: a.integer().required(),
      direccion: a.ref("Direccion").required(),
      estado: a.ref("EstadoTarjeta").required(),
      nivel: a.integer(), // 1 = 1 d, 2 = 3 d, 3 = 7 d, 4 = 14 d, 5 = 30 d, 6 = 60 d, 7 = 90 d o más
      intervaloDias: a.float(),
      proximaFecha: a.datetime(),
      ultimaFecha: a.datetime(),
      estabilidad: a.float(),
      dificultad: a.float(),
      nRepasos: a.integer(),
      nFallos: a.integer(),
      fechaInicio: a.datetime(),
      fechaAprendida: a.datetime(),
      owner: propietario(),
    })
    .secondaryIndexes((index) => [index("owner").queryField("tarjetasPorOwner")])
    .authorization((allow) => [allow.owner(), allow.group("admin").to(["read"])]),

  // Libro, tema o texto. No se guarda el texto original (derechos de autor), solo sus palabras.
  Conjunto: a
    .model({
      nombre: a.string().required(),
      tipo: a.ref("TipoConjunto").required(),
      descripcion: a.string(),
      nTokens: a.integer(), // palabras totales del texto
      nTokensEnLista: a.integer(),
      lectores: lectores(),
      owner: propietarioConjunto(),
      palabras: a.hasMany("ConjuntoPalabra", "conjuntoId"),
    })
    .authorization((allow) => [
      allow.owner(),
      allow.group("admin"),
      allow.groupsDefinedIn("lectores").to(["read"]),
    ]),

  ConjuntoPalabra: a
    .model({
      conjuntoId: a.id().required(),
      conjunto: a.belongsTo("Conjunto", "conjuntoId"),
      palabraId: a.integer().required(),
      ocurrencias: a.integer(),
      lectores: lectores(),
      owner: propietarioConjunto(),
    })
    .secondaryIndexes((index) => [index("conjuntoId"), index("palabraId")])
    .authorization((allow) => [
      allow.owner(),
      allow.group("admin"),
      allow.groupsDefinedIn("lectores").to(["read"]),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});
