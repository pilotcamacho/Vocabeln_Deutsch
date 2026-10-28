// Base local del dispositivo (IndexedDB con Dexie): una por usuario, para que dos personas
// puedan compartir un dispositivo. Permite estudiar sin conexión; sincronizar.ts la une con la
// nube.

import Dexie, { type EntityTable, type Table } from 'dexie'
import type { RepasoLocal, TarjetaLocal } from '../motor/reglas'

interface Meta {
  clave: string
  valor: unknown
}

export type BaseLocal = Dexie & {
  tarjetas: Table<TarjetaLocal, [number, string]>
  repasos: EntityTable<RepasoLocal, 'id'>
  meta: EntityTable<Meta, 'clave'>
}

export function abrirBase(usuarioId: string): BaseLocal {
  const db = new Dexie(`vocabeln-${usuarioId}`) as BaseLocal
  db.version(1).stores({
    tarjetas: '[palabraId+direccion], pendiente',
    repasos: 'id, fechaHora, palabraId, enviado',
    meta: 'clave',
  })
  return db
}

export async function leerMeta<T>(db: BaseLocal, clave: string, porDefecto: T): Promise<T> {
  const fila = await db.meta.get(clave)
  return fila ? (fila.valor as T) : porDefecto
}

export async function guardarMeta(db: BaseLocal, clave: string, valor: unknown): Promise<void> {
  await db.meta.put({ clave, valor })
}

/** Identificador de este dispositivo, para el campo «dispositivo» de los repasos. */
export async function idDispositivo(db: BaseLocal): Promise<string> {
  let id = await leerMeta<string | null>(db, 'dispositivo', null)
  if (!id) {
    id = crypto.randomUUID()
    await guardarMeta(db, 'dispositivo', id)
  }
  return id
}

/** Guarda un repaso y las tarjetas que cambia, todo o nada. */
export async function guardarRepaso(db: BaseLocal, repaso: RepasoLocal, tarjetas: TarjetaLocal[]): Promise<void> {
  await db.transaction('rw', db.repasos, db.tarjetas, async () => {
    await db.repasos.add(repaso)
    await db.tarjetas.bulkPut(tarjetas)
  })
}
