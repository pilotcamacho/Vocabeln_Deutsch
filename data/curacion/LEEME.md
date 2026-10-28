# Curación de la lista maestra

Correcciones hechas a mano sobre `data/lista_maestra.csv`. La maestra **no se edita**: se
regenera con `scripts/construir_lista_maestra.py`. Estas correcciones se aplican encima con

```
python -I -X utf8 scripts/aplicar_curacion.py
```

que escribe `data/lista_curada.csv` (mismas columnas que la maestra, más `tipo_pista`,
`orden_maestra`, `significado_maestra`, `curado` y `nota_curacion`).

Todas las filas se identifican por **`lema` + `categoria` + `significado_n` de la maestra** (no
por `orden`, que cambia al regenerar). En la lista curada ese número se conserva en
`significado_maestra`, porque `significado_n` se renumera tras los descartes. Si al regenerar la
maestra una clave ya no existe, el script avisa.

Después de aplicar la curación, se exporta a la app con `scripts/exportar_palabras.py`, que
asigna ids permanentes (ver `CLAUDE.md`, «Exportación a la app»).

## Archivos

| Archivo | Columnas | Efecto |
|---|---|---|
| `correcciones.csv` | `lema,categoria,significado_n,columna,valor,motivo` | Sustituye el valor de una columna. Si cambia `traduccion_es`, `fuente_traduccion` pasa a «curada» |
| `descartes.csv` | `lema,categoria,significado_n,motivo` | Elimina el significado. `significado_n` vacío elimina la palabra entera. Los significados restantes se renumeran |
| `pistas.csv` | `lema,categoria,significado_n,pista,tipo_pista` | Sustituye la pista (`significado_n` vacío = todos los significados de la palabra). `tipo_pista`: `etimología`, `truco` o `uso` (ver abajo) |
| `tramos.csv` | `desde,hasta,fecha,estado` | Tramos de la maestra (por `orden`) ya revisados. Estados: `borrador`, `validado` |

## Criterios

- **Traducción**: la equivalencia española más común primero; como máximo unas 3 opciones;
  sin arcaísmos ni regionalismos raros. Si hace falta, se añade un mini ejemplo entre
  paréntesis y en cursiva (`a (con horas: *um acht Uhr*)`).
- **Significados**: un significado secundario solo se queda si el español necesita otra palabra
  y es frecuente. Los duplicados o marginales se descartan.
- **Pista**: se muestra **después** de intentar recordar, o tras un fallo, nunca en la cara de
  la pregunta. Siempre con una frase o expresión alemana real si cabe. Tres tipos:
  - `etimología`: afirma algo sobre el origen de la palabra (cognados, partes, préstamos).
    Tiene que ser verdad; ante la duda, mejor una pista de `uso`.
  - `truco`: asociación inventada de sonido o imagen (*auch* = «¡ouch!»). Solo si el parecido
    se oye de verdad al pronunciar la palabra alemana, no solo al leerla. Nunca frases
    arbitrarias del tipo «siempre menciona a su hermana».
  - `uso`: expresiones, ejemplos, falsos amigos o compuestos frecuentes.
  En la lista curada, las pistas que no se han revisado a mano llevan `tipo_pista` = `automática`.
  El script las rehace con los datos ya curados: cada raíz lleva la primera opción de su
  traducción curada (así, corregir *hin* arregla todas sus derivadas), se usan las `raices` y
  los `afijos` corregidos, y se quitan los falsos parecidos con el inglés que en realidad son
  palabras alemanas (*Arbeiter* «como el inglés *arbeiten*»).
