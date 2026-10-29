# Ciclo de vida de una palabra

Este documento cuenta qué le pasa a una palabra desde que es **nueva** para un estudiante hasta
que está **terminada** (*aprendida*) y ya no se vuelve a preguntar nunca.

Las reglas están en `src/motor/reglas.ts` (qué pasa al responder) y `src/motor/cola.ts` (qué
se pregunta cada día). Si este documento y el código no coinciden, manda el código, y hay que
corregir el documento.

## Antes de llegar al estudiante

Una palabra no aparece en la app hasta que pasa por estos pasos:

1. **Lista maestra.** Entra en `data/lista_maestra.csv` por su frecuencia, con su traducción,
   su gramática y sus raíces.
2. **Curación.** Se revisa a mano en su tramo de 500. Se corrige la traducción, se descartan los
   significados repetidos o marginales y se escribe una pista.
3. **Validación.** El tramo se aprueba y pasa a `validado`. **Solo las palabras validadas se
   presentan como nuevas.** Las demás se pueden marcar como conocidas, pero no estudiar.
4. **Exportación.** Recibe un `palabra_id` permanente y entra en `palabras.json`, que es lo que
   descarga la app.

Recuerda que la unidad de estudio es el **significado**: *Schloss* (cerradura) y *Schloss*
(castillo) son dos palabras distintas, cada una con su ciclo.

## Las tarjetas de una palabra

Cada palabra tiene una o dos tarjetas, y cada una lleva su propio estado y su propia memoria:

| Palabras | Tarjetas |
|---|---|
| Las 8.000 primeras (`orden` ≤ 8.000) | **Reconocer** (alemán → español) y **producir** (español → alemán) |
| A partir de la 8.001 | Solo **reconocer** |

La palabra está **terminada** cuando lo está su última tarjeta: la de **producir** en las 8.000
primeras y la de **reconocer** en las demás.

## Los estados

```
                 ┌──────────────── marcar «la conozco» ────────────────┐
                 │                                                     ▼
  NUEVA ──primera vez──▶ APRENDIENDO ──acierto──▶ EN REPASO      CONOCIDA
                            ▲   │                 (niveles 1–7)       │
                            │   └─fallo: se repite                     │ control a los 7–30 días
                            └─────── fallo ──────────┘                 │
                                                     │                 │
                         acierto tras ≥ 90 días      │   acierto       │   fallo → APRENDIENDO
                                                     ▼                 ▼
                                                 APRENDIDA ◀───────────┘
                                              (final: no se pregunta más)

  Solo para la tarjeta de reconocer:  EN REPASO / APRENDIENDO ──▶ RETIRADA
  (cuando la de producir se acierta tras ≥ 21 días)
```

| Estado | Qué significa | ¿Se pregunta? |
|---|---|---|
| **Nueva** | Todavía no se ha estudiado. | Cuando le toque en la cola |
| **Aprendiendo** | Ya se presentó, pero aún no se ha recordado con un día de separación. | Sí, varias veces en la misma sesión |
| **En repaso** | Se ha recordado al menos una vez. Tiene un **nivel** del 1 al 7. | Sí, el día que toca |
| **Conocida** | El estudiante la marcó como sabida. Espera un control. | Una vez, en el control |
| **Aprendida** | Recordada tras 90 días o más. **Estado final.** | Nunca más |
| **Retirada** | Tarjeta de reconocer que ya no hace falta porque la producción va bien. **Final.** | Nunca más |

## El camino normal, paso a paso

### 1. Entra como nueva

Cada día la cola admite como mucho **`nuevasPorDia`** palabras nuevas (15 por defecto, y lo
ajusta cada estudiante). Para entrar, una palabra tiene que cumplir:

- **Estar en un tramo validado.**
- **Raíces antes que compuestos.** Todas sus raíces deben haberse recordado alguna vez, es
  decir, estar *en repaso*, *conocida*, *aprendida* o *retirada*. Por ejemplo, *Haustür* no
  entra hasta que se sepan *Haus* y *Tür*. Si falta una raíz, la raíz se adelanta y entra ella
  en su lugar.
- **Orden de entrada.** Primero las palabras del **conjunto activo** (un libro o un texto que el
  estudiante eligió) y después las demás, por orden de frecuencia.

La primera tarjeta siempre es la de **reconocer** (alemán → español).

### 2. Aprendiendo: la misma sesión

La tarjeta muestra la palabra alemana. El estudiante intenta recordar el significado **antes**
de verlo y después responde con sinceridad:

- **«Lo sabía»**: en FSRS cuenta como *Good*.
- **«No lo sabía»**: en FSRS cuenta como *Again*.

La pista curada (etimología, uso o truco) aparece **después** de responder, nunca antes, para
no regalar la respuesta.

Mientras está *aprendiendo*, la tarjeta vuelve a salir en la misma sesión tras unos minutos
(pasos de 1 y 10 minutos). Cuando se acierta pasados esos pasos, sale de *aprendiendo* y pasa a
*en repaso*, con su primer intervalo de días.

### 3. En repaso: los niveles

Desde aquí la palabra se pregunta **solo el día que toca**. Ese día lo calcula **FSRS**, que
estima la probabilidad de recordarla e intenta preguntarla justo antes de que se olvide, para
recordarla 9 de cada 10 veces (`retencionObjetivo` = 0,90).

- **Acierto:** el intervalo crece, a veces mucho: días, semanas, meses.
- **Fallo:** la palabra vuelve a *aprendiendo*, se repite en la sesión y su intervalo se acorta.
  FSRS también la marca como más difícil, así que en adelante crece más despacio.

Los intervalos no son fijos. Dependen de la palabra (cuántas veces se ha fallado y cuánto ha
costado) y del historial del estudiante.

El **nivel** solo sirve para ver el avance. Sale del intervalo actual:

| Nivel | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| Intervalo desde | 1 día | 3 días | 1 semana | 2 semanas | 1 mes | 2 meses | 3 meses |

En la cola del día van primero los repasos con **menor probabilidad de recordar**, es decir, los
que más riesgo tienen de olvidarse.

### 4. Se desbloquea la producción (solo las 8.000 primeras)

En cuanto la tarjeta de **reconocer** está *en repaso*, la palabra puede estrenar su tarjeta de
**producir** (español → alemán). Esta tarjeta tiene su propio ciclo: empieza en *aprendiendo*
y sube por los mismos niveles.

- Las tarjetas de producir nuevas también tienen un tope diario de `nuevasPorDia`, aparte del
  de las palabras nuevas.
- **Nunca las dos direcciones el mismo día.** Si una dirección ya se preguntó hoy, la otra
  espera a mañana: la segunda sería una respuesta regalada. Si las dos tocan el mismo día, va la
  de producir, que ya incluye reconocer.
- En los sustantivos, la respuesta debe llevar el **artículo** (*der Tisch*, no *Tisch*).

### 5. Se retira el reconocimiento

Quien produce bien una palabra también la reconoce. Por eso, cuando la tarjeta de **producir**
se acierta con **21 días o más** desde su repaso anterior, la de **reconocer** pasa a
*retirada* y no se pregunta más. Así se ahorran repasos.

Si después la producción falla, el reconocimiento **no** vuelve: la propia producción ya
entrena la palabra.

### 6. Aprendida: terminada

Una tarjeta pasa a **aprendida** cuando se **acierta en un repaso hecho 90 días o más** después
del anterior. Es un estado **final**: la palabra entra en la lista de aprendidas y no se vuelve
a preguntar nunca.

- En las 8.000 primeras, la palabra está terminada cuando lo está la tarjeta de **producir**.
  Si antes llega a aprendida la de reconocer, eso no basta: hay que seguir con la de producir.
- En las demás, basta con la tarjeta de **reconocer**.

## El atajo: marcar palabras conocidas

Las palabras que el estudiante ya sabe no hace falta estudiarlas desde cero. Puede marcarlas
como conocidas en **Marcar**: deslizando en el móvil o con la lista por tramos en la web.

1. **Marcar** la pone en *conocida*. No gasta el cupo de nuevas.
2. Entre **7 y 30 días después** (el día se reparte al azar para no juntar la carga) llega un
   **control**. Es en producción si la palabra es de las 8.000 primeras y en reconocimiento si no.
3. Según la respuesta en el control:
   - **Acierto:** pasa directamente a **aprendida**. Se considera un saber previo y asentado, y
     no hay que esperar los 90 días.
   - **Fallo:** empieza a estudiarse en *aprendiendo*, y el fallo cuenta como su primera
     presentación.
4. **Desmarcar** una palabra marcada la devuelve a *nueva*. No se borra nada del historial.

## Cómo se ve en el informe

El informe muestra un solo estado por palabra, el más avanzado de sus tarjetas:

- **Aprendida:** su última tarjeta está aprendida.
- **Conocida:** está marcada y espera su control.
- **En repaso:** al menos una tarjeta se ha recordado. Se muestra el nivel más alto.
- **Aprendiendo:** se ha empezado pero aún no se ha recordado.
- **Nueva:** sin empezar.

Los dos números de progreso son las **palabras aprendidas** y las **palabras en curso**.

## Ejemplo

Es una palabra de las 8.000 primeras, *der Löffel* (la cuchara). Las fechas son orientativas,
porque los intervalos reales los calcula FSRS.

| Día | Tarjeta | Qué pasa | Estado después |
|---|---|---|---|
| 1 | Reconocer | Sale como nueva. Falla, la ve otra vez y acierta en la misma sesión. | Aprendiendo → en repaso (nivel 1) |
| 2–3 | Reconocer | Acierta. | En repaso, el intervalo crece |
| 4 | Producir | Se desbloquea. Ese día no se pregunta el reconocimiento. Escribe *der Löffel*. | Producir: aprendiendo → en repaso |
| 10, 25… | Producir | Aciertos con intervalos cada vez más largos. | Niveles 3, 4, 5… |
| ~25 | Reconocer | Producir se acierta tras 21 días o más, así que reconocer se retira. | Reconocer: retirada |
| ~60 | Producir | Falla. Se repite en la sesión y el intervalo se acorta. | Producir: aprendiendo → en repaso |
| … | Producir | Vuelve a subir. | … |
| ≥ 90 días después del repaso anterior | Producir | Acierta. | **Aprendida: terminada** |

## Datos que se guardan

Cada respuesta se guarda como un **repaso**, con la fecha, la dirección, el resultado, el
tiempo de respuesta y la probabilidad de recordar que preveía FSRS. Primero se guarda en el
dispositivo, así que funciona sin conexión, y después se sincroniza con la nube.

Las tarjetas se **reconstruyen** a partir de ese historial, que es la fuente de verdad. Por eso
dos dispositivos con los mismos repasos llegan siempre al mismo estado. Con estos datos se
ajustarán más adelante los parámetros de FSRS de cada estudiante (fase 6).

## Números que se pueden ajustar

Son un punto de partida y se revisarán con los datos del registro:

| Regla | Valor | Constante |
|---|---|---|
| Palabras con las dos direcciones | `orden` ≤ 8.000 | `CORTE_DOS_DIRECCIONES` (`scripts/exportar_palabras.py`) |
| Desbloquear la producción | reconocimiento *en repaso* (intervalo de 1 día o más) | `cola.ts` |
| Retirar el reconocimiento | acierto en producción tras 21 días o más | `DIAS_RETIRAR_RECONOCIMIENTO` |
| Pasar a aprendida | acierto tras 90 días o más | `DIAS_APRENDIDA` |
| Control de una palabra marcada | entre 7 y 30 días | `DIAS_CONTROL` |
| Palabras nuevas al día | 15 por defecto | perfil, `nuevasPorDia` |
| Probabilidad de recordar objetivo | 0,90 | perfil, `retencionObjetivo` |
| Cambio de día | 4 de la madrugada | `HORA_CAMBIO_DIA` |
