// Perfil del estudiante (ajustes). Se guarda en la nube y se copia en la base local para
// poder estudiar sin conexión.

import { generateClient } from 'aws-amplify/data'
import type { Schema } from '../../amplify/data/resource'
import { guardarMeta, leerMeta, type BaseLocal } from './base'

const cliente = generateClient<Schema>()

export interface Ajustes {
  id?: string
  nombre: string
  nuevasPorDia: number
  retencionObjetivo: number
  /** Conjunto priorizado: sus palabras nuevas van primero en la cola */
  conjuntoActivoId?: string | null
}

export const AJUSTES_INICIALES: Ajustes = { nombre: '', nuevasPorDia: 15, retencionObjetivo: 0.9 }

export const ajustesLocales = (db: BaseLocal) => leerMeta(db, 'perfil', AJUSTES_INICIALES)

/**
 * Lee el perfil de la nube (lo crea la primera vez) y lo copia en local. Un admin lee los
 * perfiles de todos: hay que quedarse con el propio (owner = «<sub>» o «<sub>::<usuario>»).
 */
export async function traerPerfil(db: BaseLocal, userId: string, nombre: string): Promise<Ajustes> {
  const propios: Schema['Perfil']['type'][] = []
  let token: string | null | undefined
  do {
    const { data, errors, nextToken } = await cliente.models.Perfil.list({ limit: 1000, nextToken: token })
    if (errors?.length) throw new Error(errors.map((e) => e.message).join('; '))
    propios.push(...data.filter((x) => (x.owner ?? '').split('::')[0] === userId))
    token = nextToken
  } while (token)
  // Si hubiera varios (dos dispositivos lo crearon a la vez), el más antiguo
  propios.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  let p = propios[0]
  if (!p) {
    const nuevo = await cliente.models.Perfil.create({ nombre })
    if (!nuevo.data) throw new Error(nuevo.errors?.map((e) => e.message).join('; ') ?? 'No se pudo crear el perfil')
    p = nuevo.data
  }
  const ajustes: Ajustes = {
    id: p.id,
    nombre: p.nombre ?? nombre,
    nuevasPorDia: p.nuevasPorDia ?? AJUSTES_INICIALES.nuevasPorDia,
    retencionObjetivo: p.retencionObjetivo ?? AJUSTES_INICIALES.retencionObjetivo,
    conjuntoActivoId: p.conjuntoActivoId ?? null,
  }
  await guardarMeta(db, 'perfil', ajustes)
  return ajustes
}

export async function cambiarAjustes(db: BaseLocal, ajustes: Ajustes): Promise<void> {
  if (!ajustes.id) throw new Error('El perfil aún no se ha descargado')
  const { errors } = await cliente.models.Perfil.update({
    id: ajustes.id,
    nuevasPorDia: ajustes.nuevasPorDia,
    retencionObjetivo: ajustes.retencionObjetivo,
    conjuntoActivoId: ajustes.conjuntoActivoId ?? null,
  })
  if (errors?.length) throw new Error(errors.map((e) => e.message).join('; '))
  await guardarMeta(db, 'perfil', ajustes)
}
