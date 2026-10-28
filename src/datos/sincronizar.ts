// Sincronización con la nube (Amplify Data). Los repasos son la fuente de verdad y solo se
// añaden, así que unir los de varios dispositivos no produce conflictos:
// 1. sube los repasos hechos sin conexión (el id lo genera el dispositivo: reenviar no duplica);
// 2. baja los repasos que llegaron a la nube desde la última vez (de otros dispositivos);
// 3. reconstruye las tarjetas de las palabras afectadas a partir de todos sus repasos;
// 4. sube las tarjetas cambiadas, que sirven para los informes.
// En un dispositivo nuevo, el paso 2 baja todo el historial.

import { generateClient } from 'aws-amplify/data'
import type { FSRS } from 'ts-fsrs'
import type { Schema } from '../../amplify/data/resource'
import { reconstruir, type RepasoLocal, type TarjetaLocal } from '../motor/reglas'
import type { Direccion } from '../palabras'
import { guardarMeta, leerMeta, type BaseLocal } from './base'

const cliente = generateClient<Schema>()

type DireccionNube = 'de_es' | 'es_de'
const aNube = (d: Direccion): DireccionNube => (d === 'de-es' ? 'de_es' : 'es_de')
const deNube = (d: DireccionNube | null | undefined): Direccion => (d === 'es_de' ? 'es-de' : 'de-es')

/** Margen al pedir lo nuevo: cubre relojes y la consistencia eventual del índice. */
const SOLAPE_MS = 5 * 60_000

export interface Usuario {
  userId: string
  username: string
}

export interface ResultadoSync {
  subidos: number
  recibidos: number
  tarjetasSubidas: number
}

type Errores = { message?: string; errorType?: string }[] | undefined

const duplicado = (errores: Errores) =>
  !!errores?.some((e) => `${e.errorType} ${e.message}`.includes('ConditionalCheckFailed'))

function lanzar(errores: Errores, que: string): never {
  throw new Error(`${que}: ${errores?.map((e) => e.message).join('; ')}`)
}

async function enParalelo<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++])
    }),
  )
}

export async function sincronizar(db: BaseLocal, u: Usuario, f: FSRS): Promise<ResultadoSync> {
  // 1. Subir repasos
  const pendientes = await db.repasos.where('enviado').equals(0).toArray()
  await enParalelo(pendientes, 8, async (r) => {
    const res = await cliente.models.Repaso.create({
      id: r.id,
      palabraId: r.palabraId,
      direccion: aNube(r.direccion),
      fechaHora: r.fechaHora,
      resultado: r.resultado,
      tipo: r.tipo,
      tiempoMs: r.tiempoMs,
      diasDesdeAnterior: r.diasDesdeAnterior,
      rPrevista: r.rPrevista,
      versionAlgoritmo: r.versionAlgoritmo,
      dispositivo: r.dispositivo,
    })
    if (res.data || duplicado(res.errors)) await db.repasos.update(r.id, { enviado: 1 })
    else lanzar(res.errors, 'Subir repaso')
  })

  // 2. Bajar los repasos nuevos en la nube
  const cursor = await leerMeta(db, 'cursorRepasos', '1970-01-01T00:00:00.000Z')
  const desde = new Date(Date.parse(cursor) - SOLAPE_MS).toISOString()
  let maximo = cursor
  let token: string | null | undefined
  const afectadas = new Set<number>()
  let recibidos = 0
  do {
    const res = await cliente.models.Repaso.repasosPorLlegada(
      { owner: `${u.userId}::${u.username}`, createdAt: { gt: desde } },
      { limit: 1000, nextToken: token },
    )
    if (res.errors?.length) lanzar(res.errors, 'Bajar repasos')
    const nuevos: RepasoLocal[] = []
    for (const r of res.data) {
      if (r.createdAt && r.createdAt > maximo) maximo = r.createdAt
      if (await db.repasos.get(r.id)) continue
      nuevos.push({
        id: r.id,
        palabraId: r.palabraId,
        direccion: deNube(r.direccion),
        fechaHora: r.fechaHora,
        resultado: r.resultado ?? 'fallo',
        tipo: r.tipo ?? 'estudio',
        tiempoMs: r.tiempoMs ?? undefined,
        diasDesdeAnterior: r.diasDesdeAnterior ?? undefined,
        rPrevista: r.rPrevista ?? undefined,
        versionAlgoritmo: r.versionAlgoritmo ?? '',
        dispositivo: r.dispositivo ?? '',
        enviado: 1,
      })
      afectadas.add(r.palabraId)
    }
    await db.repasos.bulkPut(nuevos)
    recibidos += nuevos.length
    token = res.nextToken
  } while (token)

  // 3. Reconstruir las tarjetas afectadas
  for (const palabraId of afectadas) {
    const repasos = await db.repasos.where('palabraId').equals(palabraId).toArray()
    const tarjetas = Object.values(reconstruir(f, palabraId, repasos))
    await db.tarjetas.bulkPut(tarjetas.map((t) => ({ ...t, pendiente: 1 as const })))
  }
  await guardarMeta(db, 'cursorRepasos', maximo)

  // 4. Subir las tarjetas cambiadas
  const cambiadas = await db.tarjetas.where('pendiente').equals(1).toArray()
  let tarjetasSubidas = 0
  await enParalelo(cambiadas, 8, async (t) => {
    const datos = aTarjetaNube(t, u.userId)
    let res = await cliente.models.Tarjeta.update(datos)
    if (!res.data) res = await cliente.models.Tarjeta.create(datos)
    if (!res.data) lanzar(res.errors, 'Subir tarjeta')
    // Solo se marca como subida si no ha cambiado mientras tanto
    await db.tarjetas
      .where('[palabraId+direccion]')
      .equals([t.palabraId, t.direccion])
      .and((x) => x.fsrs.reps === t.fsrs.reps && x.estado === t.estado)
      .modify({ pendiente: 0 })
    tarjetasSubidas++
  })

  await guardarMeta(db, 'ultimaSync', new Date().toISOString())
  return { subidos: pendientes.length, recibidos, tarjetasSubidas }
}

const iso = (d: Date | string | undefined) => (d ? new Date(d).toISOString() : null)

function aTarjetaNube(t: TarjetaLocal, userId: string) {
  return {
    id: `${userId}_${t.palabraId}_${aNube(t.direccion)}`,
    palabraId: t.palabraId,
    direccion: aNube(t.direccion),
    estado: t.estado,
    nivel: t.nivel,
    intervaloDias: t.fsrs.scheduled_days,
    proximaFecha: iso(t.fsrs.due),
    ultimaFecha: iso(t.fsrs.last_review),
    estabilidad: t.fsrs.stability,
    dificultad: t.fsrs.difficulty,
    nRepasos: t.fsrs.reps,
    nFallos: t.fsrs.lapses,
    fechaInicio: iso(t.fechaInicio),
    fechaAprendida: iso(t.fechaAprendida),
    fsrs: JSON.stringify(t.fsrs),
  }
}
