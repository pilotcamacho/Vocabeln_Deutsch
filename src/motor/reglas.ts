// Reglas de una tarjeta al responder (CLAUDE.md, «Registro de progreso por estudiante» y
// «Dos direcciones»; docs/diseno_app.md, «Marcar palabras conocidas»). Código puro: no toca la
// base de datos ni la red.
//
// El historial de repasos es la fuente de verdad. Las tarjetas se obtienen aplicando los
// repasos en orden con reconstruir(); ts-fsrs es determinista (la variación aleatoria de los
// intervalos sale de una semilla calculada con la fecha y la tarjeta), y el día del control de
// una palabra marcada sale del id del repaso, así que dos dispositivos con los mismos repasos
// llegan a las mismas tarjetas.

import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type FSRS } from 'ts-fsrs'
import type { Direccion, Palabra } from '../palabras'

export const VERSION_ALGORITMO = 'ts-fsrs@5.4/FSRS-6 · reglas v2'

/** Un acierto tras al menos estos días desde el repaso anterior → aprendida (estado final). */
export const DIAS_APRENDIDA = 90
/** Un acierto en producción tras al menos estos días → se retira el reconocimiento. */
export const DIAS_RETIRAR_RECONOCIMIENTO = 21
/** Niveles de repaso según el intervalo en días: 1 = 1 d, 2 = 3 d … 7 = 90 d o más. */
export const UMBRALES_NIVEL = [1, 3, 7, 14, 30, 60, 90]
/** Una palabra marcada como conocida recibe su control entre estos días después, al azar. */
export const DIAS_CONTROL = [7, 30] as const

/** nueva = sin estudiar; una tarjeta vuelve a nueva si se desmarca una palabra marcada. */
export type Estado = 'nueva' | 'aprendiendo' | 'repaso' | 'conocida' | 'aprendida' | 'retirada'
export type Resultado = 'fallo' | 'acierto'
/** estudio · marcado (acierto = la conozco, fallo = deshacer la marca) · control */
export type TipoRepaso = 'estudio' | 'marcado' | 'control'

export interface TarjetaLocal {
  palabraId: number
  direccion: Direccion
  estado: Estado
  fsrs: Card
  nivel: number
  fechaInicio: Date
  fechaAprendida?: Date
  /** 1 = cambiada y aún sin subir a la nube */
  pendiente: 0 | 1
}

export interface RepasoLocal {
  id: string
  palabraId: number
  direccion: Direccion
  fechaHora: string // ISO
  resultado: Resultado
  tipo: TipoRepaso
  tiempoMs?: number
  diasDesdeAnterior?: number
  rPrevista?: number
  versionAlgoritmo: string
  dispositivo: string
  /** 1 = ya está en la nube */
  enviado: 0 | 1
}

/** Estados que se preguntan: aprendiendo y repaso (estudio) y conocida (control). */
export const ACTIVOS: readonly Estado[] = ['aprendiendo', 'repaso']
export const FINALES: readonly Estado[] = ['aprendida', 'retirada']

export function planificador(retencionObjetivo = 0.9): FSRS {
  return fsrs(generatorParameters({ request_retention: retencionObjetivo, enable_fuzz: true }))
}

export function nivelDe(intervaloDias: number): number {
  return UMBRALES_NIVEL.filter((u) => intervaloDias >= u).length
}

/** El control se hace en producción si la palabra se estudia en las dos direcciones. */
export const direccionControl = (p: Pick<Palabra, 'direcciones'>): Direccion =>
  p.direcciones.includes('es-de') ? 'es-de' : 'de-es'

/** Días hasta el control, entre DIAS_CONTROL, fijados por el id del repaso (FNV-1a). */
export function diasControl(semilla: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < semilla.length; i++) h = Math.imul(h ^ semilla.charCodeAt(i), 0x01000193)
  const [min, max] = DIAS_CONTROL
  return min + ((h >>> 0) % (max - min + 1))
}

/** Las dos tarjetas (o la única) de una palabra, por dirección. */
export type TarjetasPalabra = Partial<Record<Direccion, TarjetaLocal>>

export interface Respuesta {
  direccion: Direccion
  resultado: Resultado
  fecha: Date
  tipo?: TipoRepaso // por defecto, estudio
  /** id del repaso: fija el día del control al marcar */
  id?: string
}

interface Efecto {
  cambiadas: TarjetaLocal[]
  diasDesdeAnterior?: number
  rPrevista?: number
}

/**
 * Aplica una respuesta a las tarjetas de una palabra. Devuelve las tarjetas cambiadas y los
 * datos calculados del repaso (días desde el anterior y probabilidad de recordar prevista).
 */
export function responder(f: FSRS, tarjetas: TarjetasPalabra, palabraId: number, r: Respuesta): Efecto {
  const actual = tarjetas[r.direccion]
  const previa = actual?.estado === 'nueva' ? undefined : actual
  const acierto = r.resultado === 'acierto'

  if (r.tipo === 'marcado') return marcar(previa, palabraId, r)

  // Control de una palabra marcada: acierto → aprendida (saber previo a largo plazo);
  // fallo → empieza a estudiarse y el fallo cuenta como su primera presentación.
  if (previa?.estado === 'conocida') {
    const { card } = f.next(createEmptyCard<Card>(r.fecha), r.fecha, acierto ? Rating.Good : Rating.Again)
    return {
      cambiadas: [
        {
          ...previa,
          estado: acierto ? 'aprendida' : 'aprendiendo',
          fsrs: card,
          nivel: 0,
          fechaAprendida: acierto ? r.fecha : undefined,
          pendiente: 1,
        },
      ],
      diasDesdeAnterior: (r.fecha.getTime() - previa.fechaInicio.getTime()) / 86_400_000,
    }
  }

  const carta: Card = previa?.fsrs ?? createEmptyCard<Card>(r.fecha)
  const nueva = carta.state === State.New
  const rPrevista = nueva ? undefined : f.get_retrievability(carta, r.fecha, false)
  const diasDesdeAnterior = carta.last_review
    ? (r.fecha.getTime() - new Date(carta.last_review).getTime()) / 86_400_000
    : undefined

  const { card } = f.next(carta, r.fecha, acierto ? Rating.Good : Rating.Again)
  const tarjeta: TarjetaLocal = {
    palabraId,
    direccion: r.direccion,
    estado: card.state === State.Review ? 'repaso' : 'aprendiendo',
    fsrs: card,
    nivel: card.state === State.Review ? nivelDe(card.scheduled_days) : 0,
    fechaInicio: previa?.fechaInicio ?? r.fecha,
    pendiente: 1,
  }
  if (acierto && diasDesdeAnterior !== undefined && diasDesdeAnterior >= DIAS_APRENDIDA) {
    tarjeta.estado = 'aprendida'
    tarjeta.fechaAprendida = r.fecha
  }
  const cambiadas = [tarjeta]

  // Producir bien implica reconocer: se deja de preguntar el reconocimiento. No se reactiva.
  const reconocimiento = tarjetas['de-es']
  if (
    r.direccion === 'es-de' &&
    acierto &&
    diasDesdeAnterior !== undefined &&
    diasDesdeAnterior >= DIAS_RETIRAR_RECONOCIMIENTO &&
    reconocimiento &&
    ACTIVOS.includes(reconocimiento.estado)
  ) {
    cambiadas.push({ ...reconocimiento, estado: 'retirada', pendiente: 1 })
  }
  return { cambiadas, diasDesdeAnterior, rPrevista }
}

// Marcar (acierto) solo afecta a palabras sin estudiar; desmarcar (fallo), solo a las marcadas.
function marcar(previa: TarjetaLocal | undefined, palabraId: number, r: Respuesta): Efecto {
  if (r.resultado === 'acierto') {
    if (previa) return { cambiadas: [] }
    const control = new Date(r.fecha.getTime() + diasControl(r.id ?? r.fecha.toISOString()) * 86_400_000)
    return {
      cambiadas: [
        {
          palabraId,
          direccion: r.direccion,
          estado: 'conocida',
          fsrs: { ...createEmptyCard<Card>(r.fecha), due: control },
          nivel: 0,
          fechaInicio: r.fecha,
          pendiente: 1,
        },
      ],
    }
  }
  if (previa?.estado !== 'conocida') return { cambiadas: [] }
  return { cambiadas: [{ ...previa, estado: 'nueva', pendiente: 1 }] }
}

/** Reconstruye las tarjetas de una palabra a partir de todos sus repasos. */
export function reconstruir(f: FSRS, palabraId: number, repasos: RepasoLocal[]): TarjetasPalabra {
  const tarjetas: TarjetasPalabra = {}
  const ordenados = [...repasos].sort((a, b) => a.fechaHora.localeCompare(b.fechaHora) || a.id.localeCompare(b.id))
  for (const rep of ordenados) {
    const actual = tarjetas[rep.direccion]
    if (actual && FINALES.includes(actual.estado)) continue
    const { cambiadas } = responder(f, tarjetas, palabraId, {
      direccion: rep.direccion,
      resultado: rep.resultado,
      fecha: new Date(rep.fechaHora),
      tipo: rep.tipo,
      id: rep.id,
    })
    for (const t of cambiadas) tarjetas[t.direccion] = t
  }
  return tarjetas
}

/** Probabilidad de recordar ahora (1 si la tarjeta aún no se ha estudiado). */
export function retencion(f: FSRS, t: TarjetaLocal, ahora: Date): number {
  return t.fsrs.state === State.New ? 1 : f.get_retrievability(t.fsrs, ahora, false)
}
