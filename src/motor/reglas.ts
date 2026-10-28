// Reglas de una tarjeta al responder (CLAUDE.md, «Registro de progreso por estudiante» y
// «Dos direcciones»). Código puro: no toca la base de datos ni la red.
//
// El historial de repasos es la fuente de verdad. Las tarjetas se obtienen aplicando los
// repasos en orden con reconstruir(); ts-fsrs es determinista (la variación aleatoria de los
// intervalos sale de una semilla calculada con la fecha y la tarjeta), así que dos dispositivos
// con los mismos repasos llegan a las mismas tarjetas.

import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type FSRS } from 'ts-fsrs'
import type { Direccion } from '../palabras'

export const VERSION_ALGORITMO = 'ts-fsrs@5.4/FSRS-6 · reglas v1'

/** Un acierto tras al menos estos días desde el repaso anterior → aprendida (estado final). */
export const DIAS_APRENDIDA = 90
/** Un acierto en producción tras al menos estos días → se retira el reconocimiento. */
export const DIAS_RETIRAR_RECONOCIMIENTO = 21
/** Niveles de repaso según el intervalo en días: 1 = 1 d, 2 = 3 d … 7 = 90 d o más. */
export const UMBRALES_NIVEL = [1, 3, 7, 14, 30, 60, 90]

export type Estado = 'aprendiendo' | 'repaso' | 'conocida' | 'aprendida' | 'retirada'
export type Resultado = 'fallo' | 'acierto'
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

export const ACTIVOS: readonly Estado[] = ['aprendiendo', 'repaso']

export function planificador(retencionObjetivo = 0.9): FSRS {
  return fsrs(generatorParameters({ request_retention: retencionObjetivo, enable_fuzz: true }))
}

export function nivelDe(intervaloDias: number): number {
  return UMBRALES_NIVEL.filter((u) => intervaloDias >= u).length
}

/** Las dos tarjetas (o la única) de una palabra, por dirección. */
export type TarjetasPalabra = Partial<Record<Direccion, TarjetaLocal>>

export interface Respuesta {
  direccion: Direccion
  resultado: Resultado
  fecha: Date
}

/**
 * Aplica una respuesta a las tarjetas de una palabra. Devuelve las tarjetas cambiadas y los
 * datos calculados del repaso (días desde el anterior y probabilidad de recordar prevista).
 */
export function responder(
  f: FSRS,
  tarjetas: TarjetasPalabra,
  palabraId: number,
  r: Respuesta,
): { cambiadas: TarjetaLocal[]; diasDesdeAnterior?: number; rPrevista?: number } {
  const previa = tarjetas[r.direccion]
  const carta: Card = previa?.fsrs ?? createEmptyCard<Card>(r.fecha)
  const nueva = carta.state === State.New
  const rPrevista = nueva ? undefined : f.get_retrievability(carta, r.fecha, false)
  const diasDesdeAnterior = carta.last_review
    ? (r.fecha.getTime() - new Date(carta.last_review).getTime()) / 86_400_000
    : undefined

  const { card } = f.next(carta, r.fecha, r.resultado === 'acierto' ? Rating.Good : Rating.Again)
  const acierto = r.resultado === 'acierto'
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

/** Reconstruye las tarjetas de una palabra a partir de todos sus repasos. */
export function reconstruir(f: FSRS, palabraId: number, repasos: RepasoLocal[]): TarjetasPalabra {
  const tarjetas: TarjetasPalabra = {}
  const ordenados = [...repasos].sort((a, b) => a.fechaHora.localeCompare(b.fechaHora) || a.id.localeCompare(b.id))
  for (const rep of ordenados) {
    const actual = tarjetas[rep.direccion]
    if (actual && !ACTIVOS.includes(actual.estado)) continue // aprendida o retirada: estado final
    const { cambiadas } = responder(f, tarjetas, palabraId, {
      direccion: rep.direccion,
      resultado: rep.resultado,
      fecha: new Date(rep.fechaHora),
    })
    for (const t of cambiadas) tarjetas[t.direccion] = t
  }
  return tarjetas
}

/** Probabilidad de recordar ahora (1 si la tarjeta aún no se ha estudiado). */
export function retencion(f: FSRS, t: TarjetaLocal, ahora: Date): number {
  return t.fsrs.state === State.New ? 1 : f.get_retrievability(t.fsrs, ahora, false)
}
