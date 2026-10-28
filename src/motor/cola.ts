// Cola de la sesión diaria (docs/diseno_app.md, «Sesión diaria»). Código puro.
//
// 1. Repasos pendientes hoy, primero los de menor probabilidad de recordar, y los controles de
//    las palabras marcadas como conocidas.
// 2. Producción desbloqueada: palabras de las dos direcciones cuyo reconocimiento ya está en
//    repaso. Como mucho nuevasPorDia al día.
// 3. Nuevas de reconocimiento, hasta nuevasPorDia: solo de tramos validados y solo si sus
//    raíces ya se han recordado alguna vez; una raíz que falta se adelanta.
// Nunca las dos direcciones de una palabra el mismo día. Marcar una palabra no cuenta como
// estudiarla: ni gasta el cupo de nuevas ni bloquea la otra dirección.

import type { FSRS } from 'ts-fsrs'
import type { Direccion, Palabra } from '../palabras'
import { ACTIVOS, retencion, type Estado, type RepasoLocal, type TarjetaLocal } from './reglas'

/** El día cambia a las 4 de la madrugada: un repaso a las 0:30 cuenta para el día anterior. */
export const HORA_CAMBIO_DIA = 4

export interface ItemCola {
  palabra: Palabra
  direccion: Direccion
  motivo: 'repaso' | 'control' | 'produccion' | 'nueva'
}

export interface DatosCola {
  palabras: Palabra[] // en orden de estudio
  porId: Map<number, Palabra>
  tarjetas: Map<string, TarjetaLocal> // clave(palabraId, direccion)
  repasosHoy: RepasoLocal[]
  nuevasPorDia: number
  ahora: Date
  f: FSRS
  /** Conjunto activo: sus palabras nuevas van primero (fase 5). */
  prioritarias?: number[]
}

export const clave = (palabraId: number, direccion: Direccion) => `${palabraId}|${direccion}`

export function inicioDelDia(ahora: Date): Date {
  const d = new Date(ahora)
  if (d.getHours() < HORA_CAMBIO_DIA) d.setDate(d.getDate() - 1)
  d.setHours(HORA_CAMBIO_DIA, 0, 0, 0)
  return d
}

export function finDelDia(ahora: Date): Date {
  const d = inicioDelDia(ahora)
  d.setDate(d.getDate() + 1)
  return d
}

// Una raíz cuenta como sabida si se ha recordado alguna vez.
const RAIZ_SABIDA: readonly Estado[] = ['repaso', 'conocida', 'aprendida', 'retirada']
const PREGUNTABLES: readonly Estado[] = [...ACTIVOS, 'conocida']

export function construirCola(d: DatosCola): ItemCola[] {
  const fin = finDelDia(d.ahora)
  const tocadasHoy = new Map<number, Set<Direccion>>()
  for (const r of d.repasosHoy) {
    if (r.tipo === 'marcado') continue
    if (!tocadasHoy.has(r.palabraId)) tocadasHoy.set(r.palabraId, new Set())
    tocadasHoy.get(r.palabraId)!.add(r.direccion)
  }
  const otraTocadaHoy = (id: number, dir: Direccion) => {
    const s = tocadasHoy.get(id)
    return !!s && [...s].some((x) => x !== dir)
  }
  // Una tarjeta en estado «nueva» (palabra desmarcada) cuenta como inexistente
  const tarjeta = (id: number, dir: Direccion) => {
    const t = d.tarjetas.get(clave(id, dir))
    return t?.estado === 'nueva' ? undefined : t
  }
  const tocada = (id: number) => tarjeta(id, 'de-es') ?? tarjeta(id, 'es-de')

  // Nuevas ya empezadas hoy, por dirección
  const inicio = inicioDelDia(d.ahora)
  let nuevasReconocimiento = 0
  let nuevasProduccion = 0
  for (const t of d.tarjetas.values()) {
    if (t.fechaInicio >= inicio && t.estado !== 'conocida' && t.estado !== 'nueva') {
      if (t.direccion === 'de-es') nuevasReconocimiento++
      else nuevasProduccion++
    }
  }

  const cola: ItemCola[] = []
  const enCola = new Set<number>() // una sola dirección por palabra y día

  // 1. Repasos pendientes
  const pendientes = [...d.tarjetas.values()]
    .filter((t) => PREGUNTABLES.includes(t.estado) && new Date(t.fsrs.due) <= fin && d.porId.has(t.palabraId))
    .filter((t) => !otraTocadaHoy(t.palabraId, t.direccion))
    .map((t) => ({ t, r: retencion(d.f, t, d.ahora) }))
    // Si las dos direcciones tocan hoy, va la producción (incluye el reconocimiento)
    .sort((a, b) => (a.t.direccion === b.t.direccion ? a.r - b.r : a.t.direccion === 'es-de' ? -1 : 1))
  const elegidas = new Map<number, (typeof pendientes)[number]>()
  for (const p of pendientes) if (!elegidas.has(p.t.palabraId)) elegidas.set(p.t.palabraId, p)
  for (const { t } of [...elegidas.values()].sort((a, b) => a.r - b.r)) {
    cola.push({
      palabra: d.porId.get(t.palabraId)!,
      direccion: t.direccion,
      motivo: t.estado === 'conocida' ? 'control' : 'repaso',
    })
    enCola.add(t.palabraId)
  }

  const libre = (p: Palabra) => !enCola.has(p.id) && !tocadasHoy.has(p.id)

  // 2. Producción desbloqueada
  for (const p of d.palabras) {
    if (nuevasProduccion >= d.nuevasPorDia) break
    if (!p.direcciones.includes('es-de') || tarjeta(p.id, 'es-de') || !libre(p)) continue
    const rec = tarjeta(p.id, 'de-es')
    if (rec && (rec.estado === 'repaso' || rec.estado === 'conocida' || rec.estado === 'aprendida')) {
      cola.push({ palabra: p, direccion: 'es-de', motivo: 'produccion' })
      enCola.add(p.id)
      nuevasProduccion++
    }
  }

  // 3. Nuevas de reconocimiento, con sus raíces delante
  const nuevas: Palabra[] = []
  const vistas = new Set<number>()
  // sabida: se ha recordado alguna vez · añadida: entra hoy como nueva · esperar: todavía no.
  // Un compuesto solo entra si todas sus raíces están sabidas; una raíz recién añadida hoy
  // aún no se ha recordado, así que su compuesto espera.
  const intentar = (p: Palabra): 'sabida' | 'esperar' | 'añadida' => {
    const t = tocada(p.id)
    if (t) return RAIZ_SABIDA.includes(t.estado) ? 'sabida' : 'esperar'
    if (vistas.has(p.id)) return 'esperar'
    vistas.add(p.id)
    if (!p.validada || !libre(p)) return 'esperar'
    let listas = true
    for (const rid of p.raices ?? []) {
      const raiz = d.porId.get(rid)
      if (!raiz) continue // raíz que no está en la lista: no cuenta
      const e = intentar(raiz)
      if (e !== 'sabida') listas = false
      if (nuevasReconocimiento + nuevas.length >= d.nuevasPorDia) return 'esperar'
    }
    if (!listas) return 'esperar'
    if (nuevasReconocimiento + nuevas.length >= d.nuevasPorDia) return 'esperar'
    nuevas.push(p)
    return 'añadida'
  }
  const candidatas = [
    ...(d.prioritarias ?? []).map((id) => d.porId.get(id)).filter((p): p is Palabra => !!p),
    ...d.palabras,
  ]
  for (const p of candidatas) {
    if (nuevasReconocimiento + nuevas.length >= d.nuevasPorDia) break
    intentar(p)
  }
  for (const p of nuevas) {
    cola.push({ palabra: p, direccion: 'de-es', motivo: 'nueva' })
    enCola.add(p.id)
  }
  return cola
}
