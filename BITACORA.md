# Bitácora

Registro de lo que se ha hecho y de dónde se quedó el trabajo, para retomarlo en una sesión
nueva. **Leer al empezar y actualizar al terminar cada sesión.** Las reglas del proyecto están
en `CLAUDE.md`; aquí va solo el avance.

> Abrir Claude siempre desde la carpeta `Vocabeln_Deutsch`. Si se abre desde otra carpeta, el
> historial queda guardado en otro proyecto y la sesión siguiente no lo ve (pasó el 28-10-2026:
> los tramos 1–2.000 se curaron en una sesión abierta desde `bacuy-y`).

## Dónde estamos

| Paso | Estado |
|---|---|
| Investigación sobre métodos de memorización | Hecha (ver `CLAUDE.md`, «Método basado en la investigación») |
| Lista maestra de 16.000 significados | Hecha: `data/lista_maestra.csv` |
| Curación manual, tramos de 500 | 1–2.000 `validado` (1.880 significados) · 2.001–16.000 sin curar |
| Herramienta de estudio | Decidida: PWA propia sobre AWS Amplify Gen 2, para varios estudiantes. Diseño en `docs/diseno_app.md` |
| Registro de progreso | Modelo de datos en `docs/diseno_app.md`; sin implementar |

**Fase 0 terminada.**
- Ids permanentes y `palabras.json`, tabla forma → lema con su lematizador de referencia.
- Repositorio en GitHub: `pilotcamacho/Vocabeln_Deutsch` (privado), rama `main`.
- AWS: cuenta 383704632098, usuario `cli-access` con AdministratorAccess, región us-east-1 y CDK
  ya preparado (`CDKToolkit`).
- Tecnología confirmada: **PWA con React y Vite**, como en `docs/diseno_app.md`. Se descartó el
  kit propio `expo-amplify-kit` porque publicar en iPhone exige la licencia de desarrollador de
  Apple; la PWA se instala desde Safari («Añadir a pantalla de inicio») sin licencia.

**Fase 1 terminada** (esqueleto Amplify; estructura en `CLAUDE.md`, «Aplicación»).
- PWA con React + Vite: acceso con Cognito en español, perfil creado al entrar, rol según el
  grupo, lista de palabras cargada (15.859 significados, 1.880 para estudiar) e indicador de
  conexión. Iconos generados desde `public/logo.svg`.
- Backend en un sandbox de AWS (`amplify-vocabelndeutsch-pilot-sandbox-d251d836b1`), con los
  cinco modelos del diseño. `tests/probar_permisos.mjs`: 19 comprobaciones, todas pasan.
- Usuarios de prueba en el sandbox: `prueba-a`, `prueba-b`, `prueba-admin` @vocabeln.invalid.
- Publicada en Amplify Hosting (app `d10r9rml7svpuc`, rama `main`):
  https://main.d10r9rml7svpuc.amplifyapp.com. Cada push a `main` despliega backend y frontend.
  `amplify.yml` usa `npm install`, no `npm ci` (ver el comentario del archivo).
- Grupo de usuarios de producción: `us-east-1_GSBsw0ciR` (el del sandbox es otro). El usuario
  se registró y está en `estudiante` (lo puso la función de alta, que funciona) y en `admin`.

Se trabaja en la rama `dev`; `main` solo recibe fusiones para publicar (ver `CLAUDE.md`,
«Aplicación»).

**Fase 2 publicada** (fusionada en `main` el 28-10-2026, despliegue 4) (estudio: tarjeta, FSRS, cola, modo sin conexión).
- `src/motor/` (reglas y cola, 10 pruebas en `npm test`), `src/datos/` (IndexedDB y
  sincronización), `src/Sesion.tsx` y `src/Tarjeta.tsx`.
- Probado en el navegador contra el sandbox con `prueba-b`: sesión de estudio, subida y
  reconstrucción completa en un «dispositivo nuevo» (base local borrada).
- Cambios de esquema: `Repaso` se sincroniza por `createdAt`; `Tarjeta` guarda la tarjeta de
  FSRS (`fsrs`); `id` declarado en `Repaso` y `Tarjeta`, porque si no la nube rechaza el id del
  dispositivo («Unauthorized on [id]»).
- Sin probar todavía: el modo sin conexión en un móvil real (modo avión).
- Detalle conocido: las teclas pulsadas muy seguidas (más rápido que el repintado) se pierden.

El usuario usará primero Android y la web; el iPhone, solo para pruebas más adelante.

**Siguiente paso:** el usuario prueba la fase 2 en Android (incluido el modo avión). Después, la
fase 3 (marcar conocidas).

La curación (tramo 2.001–2.500) puede seguir en paralelo.

## Cómo se cura un tramo

1. Volcar las filas del tramo de `data/lista_curada.csv` (por `orden_maestra`) y leerlas todas.
2. Escribir las correcciones en `data/curacion/` según `data/curacion/LEEME.md`:
   `correcciones.csv`, `descartes.csv` y `pistas.csv`. Cada fila se identifica por
   `lema` + `categoria` + `significado_n`.
3. Añadir el tramo a `tramos.csv` con estado `borrador`.
4. Regenerar: `python -I -X utf8 scripts/aplicar_curacion.py`, y después
   `python -I -X utf8 scripts/exportar_palabras.py`. Ninguno debe avisar de claves perdidas.
5. Comprobar que no queda ninguna fila del tramo sin pista ni con la glosa inglesa como
   traducción (`fuente_traduccion` = «Wiktionary (inglés)»).
6. Presentar un resumen al usuario. Señalar las etimologías escritas de memoria que conviene
   verificar.
7. Solo con la aprobación explícita del usuario: pasar el tramo a `validado` y empezar el
   siguiente. **Nunca encadenar tramos sin aprobación.**

Errores que hay que buscar en cada tramo:
- traducciones equivocadas de WikDict;
- significados secundarios marginales o duplicados;
- palabras con frecuencia falsa (imperativos, nombres propios, formas mal lematizadas);
- raíces falsas (*Version* = *Vers* + *Ion*);
- cognados ingleses falsos;
- pistas automáticas que glosan la raíz con un sentido que no corresponde (*gemein* «malo» en *gemeinsam*);
- en un `truco`, que el parecido se oiga de verdad al pronunciar la palabra.

## Historial

### 28-10-2026

- Se escribió `CLAUDE.md`: propósito, notas sobre preposiciones, género y verbos irregulares,
  y método basado en la investigación.
- Se buscaron listas de frecuencia y se descargaron DeReWo, SUBTLEX-DE, Wiktionary (kaikki) y
  WikDict en `data/raw/`.
- Se creó `scripts/construir_lista_maestra.py` → `data/lista_maestra.csv` (16.000 significados,
  14.156 lemas).
- En una sesión paralela (abierta por error desde `bacuy-y`) se hizo lo siguiente:
  - Se creó la curación: `data/curacion/` y `scripts/aplicar_curacion.py`, que genera
    `data/lista_curada.csv`. Se añadieron las columnas `tipo_pista`, `orden_maestra`, `curado`
    y `nota_curacion`.
  - Tramos 1–500, 501–1.000 y 1.001–1.500 curados y aprobados por el usuario.
  - Se fijaron criterios de pista tras la de *erwähnen* («siempre menciona a su hermana»),
    que no tenía base. Tipos: `etimología`, `truco` (solo con parecido sonoro real) y `uso`.
  - Se decidieron las dos direcciones (reconocer y producir) hasta la palabra 8.000 y se
    añadieron a `CLAUDE.md`.
  - Las pistas automáticas se rehacen con las raíces y las traducciones ya curadas.
  - Tramo 1.501–2.000 curado en `borrador`.
- Esta sesión hizo una segunda revisión del tramo 1.501–2.000 y de restos de los tramos anteriores:
  - Pistas nuevas o corregidas:
    - Sin pista hasta ahora: *Tote*.
    - Glosa engañosa: *gemeinsam* (decía *gemein* = malo), *Nachmittag* (*nach* = a).
    - Pista pobre o con un error: *finanziell*, *Wissenschaftler*, *normalerweise*, *Kapitän* (decía «como el inglés *kapit*»).
    - Origen mejorado: *Lager* (cerveza *lager*), *weinen* (de *weh*/«woe», no de «whine»).
    - *warum* y los compuestos con *da-*: *damit*, *dabei*, *dafür*, *davon*, *dagegen*.
  - *Club*: la traducción queda como curada.
  - Lista curada: 15.859 significados.
  - El usuario aprobó el tramo 1.501–2.000: pasa a `validado`.
  - Herramienta de estudio. Decisiones del usuario:
    - todo en AWS Amplify, sin otros servicios de pago;
    - varios estudiantes;
    - marcar en bloque las palabras ya conocidas, con un control posterior;
    - informe de progreso;
    - conjuntos (libros, temas, textos) en relación muchos a muchos, públicos del administrador
      y privados de cada estudiante;
    - las palabras de un texto que no están en la lista se ignoran y se mide la cobertura;
    - un conjunto se puede priorizar.

    Se escribió el diseño en `docs/diseno_app.md`.
  - Ids permanentes, para que el historial nunca apunte a otro significado:
    - `aplicar_curacion.py` añade la columna `significado_maestra`;
    - nuevo `scripts/exportar_palabras.py`, que genera `data/export/palabras.json` y el registro
      `data/ids_palabras.csv` (15.859 ids, todos activos).
    - Probado en una copia: repetir sin cambios, descartar *Schloss* 1 (*Schloss* 2 conserva su
      id aunque se renumera), traducción cambiada, clave desaparecida, reemplazo inválido y
      retiro manual.
  - En `palabras.json` hay 14 raíces que no son palabras de la lista y se ignoran: *Esse*, *Gute*,
    *Haufen*, *Ion*, *Miss*, *Ur*, *Warte*, *des*, *ein*, *genannt*, *häufen*, *muten*, *stet*,
    *zeihen*. Varias son raíces falsas que conviene corregir al curar su tramo.
  - Repositorio git local: primer commit con todo menos `data/raw/` (≈2,2 GB de datos de
    terceros, en `.gitignore`).
  - Tabla forma → lema (`scripts/construir_formas.py`):
    - 14.131 lemas, 95.161 formas y 12.116 verbos separables partidos;
    - se excluyen las palabras funcionales y se añaden las contracciones (*am* → *an*).

    Lematizador de referencia `scripts/lematizar.py`, probado con `tests/texto_prueba.txt`:
    acierta *ankam* → *ankommen*, *stieg aus* → *aussteigen*, *sah sich um* → *umsehen*,
    *rief an*, *fing an*, *kam heraus*, *aufzustehen*, *besten* → *gut*. En ese texto, el 58 %
    de las palabras están en la lista; el resto son palabras funcionales y nombres propios.

- Fase 1:
  - repositorio subido a GitHub; se confirmó la PWA en lugar de Expo (licencia de Apple);
  - esqueleto de la PWA y backend Amplify Gen 2 en un sandbox;
  - dos ajustes tras las pruebas de permisos: el `owner` completo es `<sub>::<username>`, y el
    `owner` de los conjuntos públicos debe poder leerlo el grupo lector.

## Pendientes conocidos

- Las ~1.150 palabras de los tramos sin curar que llevan la glosa inglesa como traducción.
- Las etimologías escritas de memoria que señaló el tramo 1.501–2.000 (*scheitern*, *kaputt*,
  *Gerücht*, *Wirtschaft*, *Reich*): revisadas en esta sesión y parecen correctas, pero no se
  han contrastado con una fuente.
- Ciclo de raíces *eskalieren* ↔ *Eskalation*.
- Los verbos separables aparecen con menos frecuencia de la real (limitación del etiquetador).
