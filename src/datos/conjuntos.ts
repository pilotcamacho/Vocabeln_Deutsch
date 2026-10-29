// Conjuntos (libros, temas, textos): los propios y los públicos. Se copian en la base local para
// que la cola pueda priorizar el conjunto activo sin conexión.

import { generateClient } from 'aws-amplify/data'
import type { Schema } from '../../amplify/data/resource'
import type { TablaFormas } from '../motor/lematizar'
import { guardarMeta, leerMeta, type BaseLocal } from './base'

const cliente = generateClient<Schema>()

export type TipoConjunto = 'libro' | 'tema' | 'texto'

export interface Conjunto {
  id: string
  nombre: string
  tipo: TipoConjunto
  descripcion?: string
  nTokens: number
  nTokensEnLista: number
  /** [palabraId, ocurrencias], de más a menos ocurrencias */
  palabras: [number, number][]
  publico: boolean
  propio: boolean
}

export type NuevoConjunto = Omit<Conjunto, 'id' | 'publico' | 'propio'>

type Errores = { message: string }[] | undefined
function comprobar(errores: Errores, que: string) {
  if (errores?.length) throw new Error(`${que}: ${errores.map((e) => e.message).join('; ')}`)
}

type Fila = Schema['Conjunto']['type']

function aLocal(c: Fila, userId: string): Conjunto {
  const palabras = typeof c.palabras === 'string' ? JSON.parse(c.palabras) : (c.palabras ?? [])
  return {
    id: c.id,
    nombre: c.nombre,
    tipo: c.tipo ?? 'texto',
    descripcion: c.descripcion ?? undefined,
    nTokens: c.nTokens ?? 0,
    nTokensEnLista: c.nTokensEnLista ?? 0,
    palabras: palabras as [number, number][],
    publico: !!c.lectores?.includes('estudiante'),
    // La API devuelve el owner recortado («<sub>») o completo («<sub>::<usuario>»)
    propio: (c.owner ?? '').split('::')[0] === userId,
  }
}

export const conjuntosLocales = (db: BaseLocal) => leerMeta<Conjunto[]>(db, 'conjuntos', [])

/** Los conjuntos propios y los públicos; los copia en local. */
export async function traerConjuntos(db: BaseLocal, userId: string): Promise<Conjunto[]> {
  const filas: Fila[] = []
  let token: string | null | undefined
  do {
    const res = await cliente.models.Conjunto.list({ limit: 100, nextToken: token })
    comprobar(res.errors, 'Leer conjuntos')
    filas.push(...res.data)
    token = res.nextToken
  } while (token)
  const conjuntos = filas.map((c) => aLocal(c, userId)).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  await guardarMeta(db, 'conjuntos', conjuntos)
  return conjuntos
}

export async function crearConjunto(c: NuevoConjunto): Promise<void> {
  const res = await cliente.models.Conjunto.create({
    nombre: c.nombre,
    tipo: c.tipo,
    descripcion: c.descripcion,
    nTokens: c.nTokens,
    nTokensEnLista: c.nTokensEnLista,
    palabras: JSON.stringify(c.palabras),
  })
  comprobar(res.errors, 'Guardar el conjunto')
}

export async function borrarConjunto(id: string): Promise<void> {
  comprobar((await cliente.models.Conjunto.delete({ id })).errors, 'Borrar el conjunto')
}

/** Solo un administrador puede publicar (lectores = estudiantes) o retirar un conjunto. */
export async function cambiarPublico(id: string, publico: boolean): Promise<void> {
  const res = await cliente.models.Conjunto.update({ id, lectores: publico ? ['estudiante'] : [] })
  comprobar(res.errors, 'Cambiar la visibilidad')
}

let formas: Promise<TablaFormas> | null = null

/** La tabla forma → lema (2,7 MB) solo se descarga al crear un conjunto. */
export function cargarFormas(): Promise<TablaFormas> {
  formas ??= fetch('/datos/formas.json').then((r) => {
    if (!r.ok) throw new Error(`No se pudo cargar la tabla de formas (${r.status})`)
    return r.json()
  })
  formas.catch(() => (formas = null))
  return formas
}
