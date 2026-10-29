// Informe de progreso (docs/diseno_app.md, «Informe de progreso»). Código puro: se calcula en el
// dispositivo con las tarjetas y los repasos locales. La vista de administrador lo calcula con
// las tarjetas de la nube, sin repasos.

import type { Direccion, Palabra } from '../palabras'
import { clave, inicioDelDia } from './cola'
import type { RepasoLocal, TarjetaLocal } from './reglas'

const DIA = 86_400_000

/** Estado de la palabra (no de cada tarjeta), del más avanzado al menos. */
export type EstadoGlobal = 'aprendida' | 'conocida' | 'repaso' | 'aprendiendo' | 'nueva'
export const ESTADOS_GLOBALES: readonly EstadoGlobal[] = ['aprendida', 'conocida', 'repaso', 'aprendiendo', 'nueva']

export interface EstadoPalabra {
  estado: EstadoGlobal
  /** Nivel de repaso (1–7) de la tarjeta más avanzada; 0 si no está en repaso. */
  nivel: number
  /** Próxima pregunta, si la tiene. */
  proxima?: Date
}

/**
 * Aprendida cuando lo está su dirección final (producción si la tiene). Conocida si está
 * marcada y pendiente de control. En repaso si alguna dirección se ha recordado ya.
 */
export function estadoPalabra(w: Palabra, tarjetas: Map<string, TarjetaLocal>): EstadoPalabra {
  const final: Direccion = w.direcciones.includes('es-de') ? 'es-de' : 'de-es'
  const ts = (['de-es', 'es-de'] as const)
    .map((d) => tarjetas.get(clave(w.id, d)))
    .filter((t): t is TarjetaLocal => !!t && t.estado !== 'nueva')
  const proximas = ts
    .filter((t) => t.estado === 'aprendiendo' || t.estado === 'repaso' || t.estado === 'conocida')
    .map((t) => new Date(t.fsrs.due))
  const proxima = proximas.length ? new Date(Math.min(...proximas.map((d) => d.getTime()))) : undefined
  if (tarjetas.get(clave(w.id, final))?.estado === 'aprendida') return { estado: 'aprendida', nivel: 7 }
  if (ts.some((t) => t.estado === 'conocida')) return { estado: 'conocida', nivel: 0, proxima }
  // El reconocimiento aprendido cuenta como el nivel más alto; el retirado, como recordado
  const niveles = ts.map((t) => (t.estado === 'repaso' ? t.nivel : t.estado === 'aprendida' ? 7 : 0))
  const nivel = Math.max(0, ...niveles)
  if (ts.some((t) => t.estado !== 'aprendiendo')) return { estado: 'repaso', nivel: Math.max(1, nivel), proxima }
  if (ts.length) return { estado: 'aprendiendo', nivel: 0, proxima }
  return { estado: 'nueva', nivel: 0 }
}

export type Desglose = Record<EstadoGlobal, number> & { total: number }

const vacio = (): Desglose => ({ aprendida: 0, conocida: 0, repaso: 0, aprendiendo: 0, nueva: 0, total: 0 })

export interface Grupo {
  nombre: string
  d: Desglose
}

export interface Semana {
  /** Inicio de la ventana de 7 días (la última termina hoy). */
  inicio: Date
  /** Palabras que empezaron a estudiarse (sin contar las marcadas como conocidas). */
  empezadas: number
  aprendidas: number
  marcadas: number
}

export interface Hito {
  palabras: number
  /** Fecha estimada para tener esas palabras empezadas; null si ya se ha llegado. */
  fecha: Date | null
}

export interface RetencionDireccion {
  direccion: Direccion
  n: number
  aciertos: number
  /** Media de la probabilidad de recordar que preveía FSRS. */
  prevista: number
}

export interface Informe {
  total: Desglose
  /** Palabras en repaso por nivel: índice 1 = nivel 1 … 7. */
  niveles: number[]
  tramos: Grupo[]
  categorias: Grupo[]
  semanas: Semana[]
  /** Palabras nuevas al día con que se proyecta, y de dónde sale. */
  ritmo: { porDia: number; fuente: 'real' | 'ajuste' }
  hitos: Hito[]
  /** Preguntas previstas por día durante 30 días; el día 0 incluye las atrasadas. */
  carga: { dia: Date; repasos: number; controles: number }[]
  /** Solo con repasos: repasos con al menos medio día desde el anterior, últimos 30 días. */
  retencion?: RetencionDireccion[]
  controles?: { n: number; aciertos: number }
}

export const TAMANO_TRAMO_INFORME = 1000
const SEMANAS = 8
const DIAS_CARGA = 30
const DIAS_RETENCION = 30
const HITOS = [500, 1000, 2000, 3000, 5000, 8000, 10000, 12000]

export interface DatosInforme {
  palabras: Palabra[] // en orden de estudio
  tarjetas: Map<string, TarjetaLocal>
  /** Sin repasos (vista de administrador) no hay retención y el ritmo sale de las tarjetas. */
  repasos?: RepasoLocal[]
  nuevasPorDia: number
  ahora: Date
}

export function calcularInforme(d: DatosInforme): Informe {
  const total = vacio()
  const niveles = Array(8).fill(0)
  const tramos = new Map<number, Desglose>()
  const categorias = new Map<string, Desglose>()
  for (const w of d.palabras) {
    const { estado, nivel } = estadoPalabra(w, d.tarjetas)
    const tramo = Math.floor((w.orden - 1) / TAMANO_TRAMO_INFORME)
    if (!tramos.has(tramo)) tramos.set(tramo, vacio())
    if (!categorias.has(w.categoria)) categorias.set(w.categoria, vacio())
    for (const g of [total, tramos.get(tramo)!, categorias.get(w.categoria)!]) {
      g[estado]++
      g.total++
    }
    if (estado === 'repaso') niveles[nivel]++
  }

  const hoy = inicioDelDia(d.ahora)
  const fechas = inicios(d)
  const semanas = calcularSemanas(d, fechas, hoy)
  const ultimas = semanas.slice(-4)
  const diasConDatos = Math.min(28, primerDiaEstudio(fechas.empezada, hoy))
  const empezadas = ultimas.reduce((s, x) => s + x.empezadas, 0)
  const ritmo =
    diasConDatos >= 7 && empezadas > 0
      ? { porDia: empezadas / diasConDatos, fuente: 'real' as const }
      : { porDia: d.nuevasPorDia, fuente: 'ajuste' as const }

  const cubiertas = total.total - total.nueva
  const objetivos = [...HITOS.filter((h) => h < total.total), total.total]
  const hitos: Hito[] = objetivos.map((palabras) => ({
    palabras,
    fecha:
      palabras <= cubiertas
        ? null
        : ritmo.porDia > 0
          ? new Date(hoy.getTime() + Math.ceil((palabras - cubiertas) / ritmo.porDia) * DIA)
          : null,
  }))

  return {
    total,
    niveles,
    tramos: [...tramos.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([t, g]) => ({
        nombre: `${(t * TAMANO_TRAMO_INFORME + 1).toLocaleString('es')}–${((t + 1) * TAMANO_TRAMO_INFORME).toLocaleString('es')}`,
        d: g,
      })),
    categorias: [...categorias.entries()].sort((a, b) => b[1].total - a[1].total).map(([nombre, g]) => ({ nombre, d: g })),
    semanas,
    ritmo,
    hitos,
    carga: calcularCarga(d, hoy),
    ...(d.repasos ? calcularRetencion(d.repasos, d.ahora) : {}),
  }
}

/** Índice del día (0 = hoy) de una fecha, con el cambio de día a las 4 de la madrugada. */
function diaRelativo(fecha: Date, hoy: Date): number {
  return Math.round((inicioDelDia(fecha).getTime() - hoy.getTime()) / DIA)
}

// Fecha en que se empezó a estudiar cada palabra (no las marcadas) y en que se aprendió
interface Inicios {
  empezada: Map<number, Date>
  marcada: Map<number, Date>
}

function inicios(d: DatosInforme): Inicios {
  const empezada = new Map<number, Date>()
  const marcada = new Map<number, Date>()
  if (d.repasos) {
    // Con repasos: el primer repaso de estudio, salvo que la palabra se marcara antes
    const ordenados = [...d.repasos].sort((a, b) => a.fechaHora.localeCompare(b.fechaHora))
    for (const r of ordenados) {
      const fecha = new Date(r.fechaHora)
      if (r.tipo === 'marcado') {
        // Desmarcar (fallo) deshace la marca
        if (r.resultado === 'fallo') marcada.delete(r.palabraId)
        else if (!marcada.has(r.palabraId) && !empezada.has(r.palabraId)) marcada.set(r.palabraId, fecha)
      } else if (r.tipo === 'estudio' && !empezada.has(r.palabraId) && !marcada.has(r.palabraId)) {
        empezada.set(r.palabraId, fecha)
      }
    }
  } else {
    // Sin repasos: la fecha de inicio de la tarjeta; las marcadas no se distinguen del todo
    for (const t of d.tarjetas.values()) {
      if (t.estado === 'nueva') continue
      const destino = t.estado === 'conocida' ? marcada : empezada
      const previa = destino.get(t.palabraId)
      const fecha = new Date(t.fechaInicio)
      if (!previa || fecha < previa) destino.set(t.palabraId, fecha)
    }
  }
  return { empezada, marcada }
}

function calcularSemanas(d: DatosInforme, { empezada, marcada }: Inicios, hoy: Date): Semana[] {
  const semanas: Semana[] = Array.from({ length: SEMANAS }, (_, i) => ({
    inicio: new Date(hoy.getTime() - (SEMANAS - 1 - i) * 7 * DIA - 6 * DIA),
    empezadas: 0,
    aprendidas: 0,
    marcadas: 0,
  }))
  const indice = (fecha: Date) => {
    const atras = -diaRelativo(fecha, hoy) // 0 = hoy
    const i = SEMANAS - 1 - Math.floor(atras / 7)
    return atras >= 0 && i >= 0 ? i : -1
  }
  for (const f of empezada.values()) {
    const i = indice(f)
    if (i >= 0) semanas[i].empezadas++
  }
  for (const f of marcada.values()) {
    const i = indice(f)
    if (i >= 0) semanas[i].marcadas++
  }
  const porId = new Map(d.palabras.map((w) => [w.id, w]))
  for (const t of d.tarjetas.values()) {
    const w = porId.get(t.palabraId)
    if (!w || t.estado !== 'aprendida' || !t.fechaAprendida) continue
    const final: Direccion = w.direcciones.includes('es-de') ? 'es-de' : 'de-es'
    if (t.direccion !== final) continue
    const i = indice(new Date(t.fechaAprendida))
    if (i >= 0) semanas[i].aprendidas++
  }
  return semanas
}

/** Días desde el primer estudio (incluido hoy), para no subestimar el ritmo al empezar. */
function primerDiaEstudio(empezada: Map<number, Date>, hoy: Date): number {
  if (!empezada.size) return 0
  const primero = Math.min(...[...empezada.values()].map((f) => f.getTime()))
  return 1 - diaRelativo(new Date(primero), hoy)
}

function calcularCarga(d: DatosInforme, hoy: Date): Informe['carga'] {
  const carga = Array.from({ length: DIAS_CARGA }, (_, i) => ({
    dia: new Date(hoy.getTime() + i * DIA),
    repasos: 0,
    controles: 0,
  }))
  const ids = new Set(d.palabras.map((w) => w.id))
  for (const t of d.tarjetas.values()) {
    if (!ids.has(t.palabraId)) continue
    if (t.estado !== 'aprendiendo' && t.estado !== 'repaso' && t.estado !== 'conocida') continue
    const i = Math.max(0, diaRelativo(new Date(t.fsrs.due), hoy))
    if (i >= DIAS_CARGA) continue
    if (t.estado === 'conocida') carga[i].controles++
    else carga[i].repasos++
  }
  return carga
}

function calcularRetencion(repasos: RepasoLocal[], ahora: Date): Pick<Informe, 'retencion' | 'controles'> {
  const desde = new Date(ahora.getTime() - DIAS_RETENCION * DIA).toISOString()
  const retencion: RetencionDireccion[] = (['de-es', 'es-de'] as const).map((direccion) => ({
    direccion,
    n: 0,
    aciertos: 0,
    prevista: 0,
  }))
  const controles = { n: 0, aciertos: 0 }
  for (const r of repasos) {
    if (r.fechaHora < desde) continue
    if (r.tipo === 'control') {
      controles.n++
      if (r.resultado === 'acierto') controles.aciertos++
      continue
    }
    // Repasos de verdad: no los pasos de aprendizaje del mismo día
    if (r.tipo !== 'estudio' || r.rPrevista === undefined || (r.diasDesdeAnterior ?? 0) < 0.5) continue
    const g = retencion[r.direccion === 'de-es' ? 0 : 1]
    g.n++
    if (r.resultado === 'acierto') g.aciertos++
    g.prevista += r.rPrevista
  }
  for (const g of retencion) if (g.n) g.prevista /= g.n
  return { retencion, controles }
}

export interface Cobertura {
  /** Apariciones en el texto de las palabras de la lista, según el estado de cada palabra */
  tokens: Desglose
  /** Apariciones de palabras fuera de la lista (funcionales, nombres propios…) */
  fuera: number
  /** Palabras del texto */
  nTokens: number
}

/** Qué parte del texto cubre cada estado, contando cada aparición. */
export function cobertura(
  palabras: [number, number][],
  porId: Map<number, Palabra>,
  tarjetas: Map<string, TarjetaLocal>,
  nTokens: number,
): Cobertura {
  const tokens = vacio()
  for (const [id, n] of palabras) {
    const w = porId.get(id)
    if (!w) continue // significado retirado de la lista
    tokens[estadoPalabra(w, tarjetas).estado] += n
    tokens.total += n
  }
  return { tokens, fuera: Math.max(0, nTokens - tokens.total), nTokens }
}
