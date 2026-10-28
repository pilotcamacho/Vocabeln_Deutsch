# Diseño de la aplicación de estudio

Propuesta del 28-10-2026. Desarrolla las reglas de `CLAUDE.md` («Registro de progreso por
estudiante», «Dos direcciones», «Orden de estudio») en una aplicación concreta.

## Decisiones del usuario

- **Todo en AWS con Amplify**, sin otros servicios externos de pago.
- **Varios estudiantes desde el principio.**
- **Marcar rápido las palabras que ya se conocen.** Quedan como *conocidas* y reciben **una
  pregunta de control**. Si se acierta, la palabra pasa a *aprendida*; si se falla, entra al
  estudio normal.
- **Informe de progreso** sobre el total de la lista.
- **Conjuntos (libros, temas, textos) en relación muchos a muchos con las palabras.** Los hay de
  dos tipos: públicos, que crea un administrador, y privados, que crea cada estudiante pegando
  un texto.
- **Las palabras de un texto que no están en la lista se ignoran**, pero el informe da la
  cobertura del texto.
- **Un conjunto puede activarse para priorizarlo**: sus palabras nuevas se adelantan en la cola,
  respetando la regla de raíces antes que compuestos.

## Plataforma

Una sola **PWA**, una aplicación web instalable que sirve para móvil y web. Funciona sin
conexión y sincroniza con AWS cuando hay red.

| Pieza | Servicio |
|---|---|
| Interfaz | React + TypeScript + Vite, PWA con *service worker* |
| Algoritmo | `ts-fsrs` (implementación oficial de FSRS en TypeScript, código abierto) |
| Datos en el dispositivo | IndexedDB (Dexie) |
| Backend | **Amplify Gen 2** |
| Usuarios | Cognito, con grupos `admin` y `estudiante` |
| API y datos | Amplify Data, es decir, AppSync (GraphQL) + DynamoDB |
| Funciones | Lambda: lematizar textos, recalcular estadísticas y ajustar FSRS |
| Alojamiento | Amplify Hosting, con despliegue desde un repositorio git (p. ej. GitHub gratuito) |

- **Sincronización sin conexión** (`src/datos/sincronizar.ts`). Amplify Gen 2 ya no ofrece
  DataStore, así que el modo sin conexión es propio. Los repasos son la fuente de verdad: cada
  dispositivo reconstruye las tarjetas aplicándolos en orden, y como `ts-fsrs` es determinista
  (la variación aleatoria de intervalos sale de una semilla fija), todos llegan al mismo estado.
  Un dispositivo nuevo baja todo el historial. Las tarjetas en la nube sirven para los informes. Los repasos se guardan en IndexedDB y se envían por lotes al recuperar la
  red. Como los repasos solo se añaden y nunca se modifican, unir los de varios dispositivos no
  produce conflictos.
- **iPhone.** La aplicación debe instalarse en la pantalla de inicio. Si no, Safari puede borrar
  los datos locales.
- **Coste.** Con pocos estudiantes, el uso cabe en la capa gratuita de AWS o cuesta muy poco.
  Para reducir llamadas, los repasos se envían en lotes.

## Contenido: las palabras

- **Archivo estático.** `lista_curada.csv` se exporta a `palabras.json`, con número de versión, y
  viaje dentro de la aplicación (≈1 MB comprimido). No pasa por DynamoDB: es igual para todos y
  así funciona sin conexión.
- **Qué se puede marcar y qué se estudia.** Todas las palabras se pueden *marcar como
  conocidas*. Para *estudiarlas*, en cambio, solo entran las de los tramos `validado`, porque
  las tarjetas necesitan la traducción y la pista curadas.
- **Identificador estable `palabra_id`** (hecho el 28-10-2026). Lo genera
  `scripts/exportar_palabras.py` con el registro `data/ids_palabras.csv`; las reglas están en
  `CLAUDE.md`, «Exportación a la app».
  - Cada significado recibe un id numérico permanente que nunca se reutiliza.
  - Un significado descartado conserva su id, marcado como `retirado`.
  - Una fusión se indica con `reemplazado_por`.

`data/export/palabras.json` (5,2 MB sin comprimir) tiene esta forma:

```
{ version: hash del contenido, generado: fecha,
  palabras: [ { id, orden, lema, categoria, significado_n, traduccion_es, articulo, genero,
                plural, presente_3sg, preterito, participio, auxiliar, separable, comparativo,
                superlativo, caso, ipa, pista, tipo_pista, raices: [id],
                direcciones: ["de-es"] | ["de-es","es-de"], validada: bool } ],
  retiradas: [id],                ← la app deja de preguntarlas y no las cuenta
  reemplazos: { id_viejo: id_nuevo } ← la app traslada el historial }
```

Los campos vacíos se omiten. `pista_produccion` aún no existe: se añadirá cuando se cure el lado
español de las tarjetas de producción.

## Modelo de datos (DynamoDB vía Amplify Data)

Implementado en `amplify/data/resource.ts` (fase 1). Los permisos se comprueban con
`tests/probar_permisos.mjs` contra el sandbox. Notas comunes:

- **`owner`** se guarda como `<sub>::<username>`, aunque la API lo devuelve recortado
  (`<sub>`). Las consultas por índice (`repasosPorFecha`, `tarjetasPorOwner`) usan el valor
  completo, que da `getCurrentUser()`: `` `${userId}::${username}` ``. El estudiante no puede
  reasignarlo.
- **`direccion`** vale `de_es` o `es_de`: los enums de GraphQL no admiten guiones. En
  `palabras.json` sigue siendo `de-es` / `es-de`.

### `Perfil`: uno por estudiante

| Campo | Notas |
|---|---|
| `id`, `owner` | `owner` = usuario de Cognito |
| `nombre` | El rol no se guarda aquí: lo dan los grupos de Cognito (`admin`, `estudiante`) |
| `nuevasPorDia` | p. ej. 15 |
| `retencionObjetivo` | 0,90 |
| `parametrosFsrs` | JSON. Al principio los genéricos; después, los ajustados a este estudiante |
| `conjuntoActivoId` | conjunto priorizado, opcional |

### `Repaso`: el historial, solo se añade y es la fuente de verdad

| Campo | Notas |
|---|---|
| `id` | uuid generado en el dispositivo, para evitar duplicados al reenviar |
| `owner`, `palabraId`, `direccion` | `de-es` o `es-de` |
| `fechaHora`, `resultado` | `fallo` o `acierto` |
| `tipo` | `estudio`, `marcado` (la marcó como conocida) o `control` |
| `tiempoMs`, `diasDesdeAnterior`, `rPrevista` | `rPrevista` = probabilidad de recordar estimada por FSRS. Sirve para comprobar si el modelo acierta |
| `versionAlgoritmo`, `dispositivo` | |

Índice: `owner` + `createdAt` (`repasosPorLlegada`), para descargar «lo nuevo desde la última
sincronización». `createdAt` es la hora de llegada a la nube y la pone el servidor; no sirve
`fechaHora`, porque un dispositivo que estuvo sin conexión sube repasos con fechas pasadas. Permisos: el estudiante solo crea y lee; nadie modifica ni borra un repaso.

### `Tarjeta`: estado actual por estudiante, palabra y dirección

Se calcula a partir de `Repaso` y se guarda para que cargar la aplicación y generar informes sea
rápido. Si hay dudas, se recalcula desde el historial.

| Campo | Notas |
|---|---|
| `id` | `<sub>_<palabraId>_<direccion>`: fijo, para actualizar siempre la misma fila |
| `owner`, `palabraId`, `direccion` | índice `tarjetasPorOwner` por `owner` |
| `estado` | `nueva` · `aprendiendo` · `repaso` · `conocida` · `aprendida` · `retirada` |
| `nivel` | según el intervalo: 1 = 1 d, 2 = 3 d, 3 = 7 d, 4 = 14 d, 5 = 30 d, 6 = 60 d, 7 = 90 d o más |
| `intervaloDias`, `proximaFecha`, `ultimaFecha` | |
| `estabilidad`, `dificultad` | FSRS |
| `nRepasos`, `nFallos`, `fechaInicio`, `fechaAprendida` | |

Solo existen filas de las palabras que el estudiante ha tocado; todas las demás son *nuevas*.
Con 16.000 palabras en dos direcciones son unas 24.000 filas como máximo por estudiante.

### `Conjunto`: libro, tema o texto

| Campo | Notas |
|---|---|
| `id`, `nombre`, `tipo` | `libro`, `tema` o `texto` |
| `descripcion` | |
| `lectores` | grupos que pueden leerlo: `["estudiante"]` = público; vacío = privado de su `owner`. Solo un admin puede rellenarlo |
| `owner`, `nTokens`, `nTokensEnLista`, `creadoEn` | `nTokens` = palabras totales del texto |

**No se guarda el texto original**, porque los libros tienen derechos de autor. Solo se guarda la
lista de palabras con sus recuentos.

### `ConjuntoPalabra`: la relación muchos a muchos

| Campo | Notas |
|---|---|
| `conjuntoId`, `palabraId` | clave, con un índice secundario por `palabraId` («¿en qué conjuntos está esta palabra?») |
| `ocurrencias` | cuántas veces aparece en el texto; sirve para calcular la cobertura |

- **Textos pegados por el estudiante.** Un lema se enlaza con su significado 1, porque no se sabe
  qué sentido usa el texto.
- **Conjuntos del administrador.** El administrador puede elegir significados concretos.

## Lógica principal

### Sesión diaria (cola)

Implementada en `src/motor/cola.ts`, con pruebas en `tests/motor.test.ts`. El día cambia a las
4 de la madrugada. Las respuestas son binarias: «No lo sabía» = *Again* y «Lo sabía» = *Good* en
FSRS. Las tarjetas en aprendizaje (pasos de 1 y 10 minutos) vuelven a salir en la misma sesión.

1. **Repasos pendientes** (`proximaFecha` ≤ hoy), primero los de menor probabilidad de recordar.
   Se incluyen los *controles* de las palabras marcadas.
2. **Producción desbloqueada**: palabras con `orden` ≤ 8.000 cuyo reconocimiento ya está
   *en repaso*. Nunca se pregunta el mismo día que la otra dirección. Como mucho `nuevasPorDia`
   al día, igual que las nuevas. Si las dos direcciones de una palabra tocan el mismo día, va la
   producción y el reconocimiento se aplaza.
3. **Nuevas**, hasta `nuevasPorDia`:
   - primero las del conjunto activo, si lo hay, y después por `orden`;
   - solo entran palabras de tramos validados;
   - solo entran si todas sus raíces están en *repaso*, *conocida* o *aprendida*. Si falta una
     raíz, se adelanta la raíz.
4. **Al guardar cada repaso** se aplican las reglas:
   - retirar el reconocimiento cuando la producción se acierta con un intervalo de 21 días o más;
   - pasar a *aprendida* con un acierto tras 90 días o más;
   - aplazar a mañana la otra dirección.

### Marcar palabras conocidas

Implementado en `src/Marcar.tsx`; las reglas, en `src/motor/reglas.ts` (`responder`, tipo `marcado`).

Hay dos modos, los dos en orden de frecuencia:

- **Deslizar**, en el móvil: aparece la palabra y se desliza a la derecha («la conozco») o a la
  izquierda («no»). Se puede deshacer. A unos 2 segundos por palabra, son unas 1.000 palabras
  en media hora.
- **Lista por tramos**, en la web: 100 palabras por pantalla con casillas, más «marcar todo el
  tramo» para después desmarcar las excepciones.

Cómo funciona la marca:

- Cada marca crea un `Repaso` con `tipo = marcado` y `resultado = acierto`. La tarjeta pasa a
  `conocida`, con un control programado entre 7 y 30 días después, al azar, para repartir la
  carga. El día sale del id del repaso, así que es el mismo en todos los dispositivos.
- **Deshacer o desmarcar** no borra nada: añade otro `Repaso` `marcado` con `resultado = fallo`,
  y la tarjeta vuelve a `nueva`. Solo afecta a palabras en `conocida`; marcar una palabra que ya
  se está estudiando no hace nada.
- La tarjeta de una palabra marcada está en la dirección del control.
- Marcar no cuenta como estudiar: no gasta el cupo de nuevas del día ni impide preguntar la
  otra dirección ese día.
- En el modo deslizar, «no» no se guarda en la nube: solo avanza el punto de partida local
  (`cursorMarcar`), para no volver a mostrar esas palabras.
- **El control** se hace en producción (español → alemán) si la palabra tiene `orden` ≤ 8.000, y
  en reconocimiento si no.
  - Si se acierta, la palabra pasa a *aprendida*: se toma como saber previo a largo plazo y no se
    exigen los 90 días.
  - Si se falla, la palabra entra en *aprendiendo* y el fallo cuenta como su primera presentación.
- Las palabras *conocidas* ya cumplen la regla de raíces.

### Informe de progreso

Se calcula en el dispositivo con las tarjetas locales, sin coste de servidor.

- **Total de la lista.** Barra apilada con aprendidas, conocidas pendientes de control, en
  repaso por nivel, aprendiendo y nuevas. *Completadas* = aprendidas.
- **Por tramos de 1.000 palabras.** Una cuadrícula con el porcentaje completado de cada tramo.
- **Por categoría.** Sustantivos, verbos, adjetivos, adverbios y preposiciones.
- **Ritmo y proyección.** Palabras aprendidas por semana y fecha estimada para completar la lista.
- **Carga.** Repasos previstos para los próximos 30 días.
- **Retención.** La real frente a la objetivo, para saber si FSRS acierta con este estudiante.
- **Por conjunto.** El mismo desglose sobre sus palabras, más la **cobertura del texto**:
  - % del texto que cubren las palabras aprendidas, contando cada aparición;
  - % que cubren las palabras en curso;
  - % de palabras fuera de la lista (funcionales, nombres propios), que se muestra aparte.
- **Para el administrador.** Un resumen por estudiante, calculado con una Lambda.

### Crear un conjunto a partir de un texto

1. El estudiante pega el texto en la aplicación.
2. Una Lambda lo divide en palabras y convierte cada forma en su lema con la tabla
   `data/export/formas.json`, generada a partir de Wiktionary (hecho el 28-10-2026). La tabla se
   incluye en la propia Lambda; no se usan servicios externos. La referencia de su
   comportamiento es `scripts/lematizar.py`.
3. Detecta los verbos separables («kommt … an» → *ankommen*) cuando la partícula está al final de
   la oración. Es una detección aproximada.
4. Guarda el `Conjunto` y sus `ConjuntoPalabra`. El texto se descarta.

## Fases

0. **Preparación.**
   - Repositorio git (necesario para Amplify Hosting) y cuenta de AWS.
   - Exportador `lista_curada.csv` → `palabras.json`, con ids estables.
   - Tabla forma → lema.
1. **Esqueleto Amplify.** Cognito con grupos, los modelos de datos y la PWA desplegada.
2. **Estudio.**
   - La tarjeta, FSRS y la cola con todas las reglas.
   - Modo sin conexión y sincronización.
3. **Marcar conocidas.** Deslizar, la lista por tramos y los controles.
4. **Informe de progreso.**
5. **Conjuntos.** Los del administrador, los privados desde un texto, la Lambda lematizadora y
   la opción de priorizar un conjunto.
6. **Optimización.** Ajustar los parámetros de FSRS de cada estudiante con su historial y
   comparar estrategias de intervalos.
