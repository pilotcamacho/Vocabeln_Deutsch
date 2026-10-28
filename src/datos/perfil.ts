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
}

export const AJUSTES_INICIALES: Ajustes = { nombre: '', nuevasPorDia: 15, retencionObjetivo: 0.9 }

export const ajustesLocales = (db: BaseLocal) => leerMeta(db, 'perfil', AJUSTES_INICIALES)

/** Lee el perfil de la nube (lo crea la primera vez) y lo copia en local. */
export async function traerPerfil(db: BaseLocal, nombre: string): Promise<Ajustes> {
  const { data, errors } = await cliente.models.Perfil.list()
  if (errors?.length) throw new Error(errors.map((e) => e.message).join('; '))
  let p = data[0]
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
  })
  if (errors?.length) throw new Error(errors.map((e) => e.message).join('; '))
  await guardarMeta(db, 'perfil', ajustes)
}
