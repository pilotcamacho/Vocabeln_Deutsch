// Vista de administrador: el informe de cada estudiante, calculado en el navegador con sus
// tarjetas de la nube (el grupo admin puede leer Perfil y Tarjeta de todos). Con pocos
// estudiantes basta con leer las tablas enteras; no hace falta una Lambda.

import { useEffect, useMemo, useState } from 'react'
import { generateClient } from 'aws-amplify/data'
import { createEmptyCard, State, type Card } from 'ts-fsrs'
import type { Schema } from '../amplify/data/resource'
import { Informe } from './Informe'
import { clave } from './motor/cola'
import { calcularInforme } from './motor/informe'
import type { Estado, TarjetaLocal } from './motor/reglas'
import type { Palabra } from './palabras'

const cliente = generateClient<Schema>()

interface Estudiante {
  owner: string
  nombre: string
  nuevasPorDia: number
  retencionObjetivo: number
  tarjetas: Map<string, TarjetaLocal>
  ultima?: Date
}

async function todas<T>(pedir: (token?: string | null) => Promise<{ data: T[]; nextToken?: string | null; errors?: { message: string }[] }>) {
  const filas: T[] = []
  let token: string | null | undefined
  do {
    const res = await pedir(token)
    if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join('; '))
    filas.push(...res.data)
    token = res.nextToken
  } while (token)
  return filas
}

// La API devuelve el owner recortado («<sub>») o completo («<sub>::<usuario>»): se usa el sub
const sub = (owner: string | null | undefined) => (owner ?? '').split('::')[0]

async function cargarEstudiantes(): Promise<Estudiante[]> {
  const [perfiles, tarjetas] = await Promise.all([
    todas((nextToken) => cliente.models.Perfil.list({ limit: 1000, nextToken })),
    todas((nextToken) => cliente.models.Tarjeta.list({ limit: 1000, nextToken })),
  ])
  const porOwner = new Map<string, Estudiante>()
  const estudiante = (owner: string) => {
    if (!porOwner.has(owner))
      porOwner.set(owner, { owner, nombre: owner.slice(0, 8), nuevasPorDia: 15, retencionObjetivo: 0.9, tarjetas: new Map() })
    return porOwner.get(owner)!
  }
  for (const p of perfiles) {
    const e = estudiante(sub(p.owner))
    e.nombre = p.nombre || e.nombre
    e.nuevasPorDia = p.nuevasPorDia ?? 15
    e.retencionObjetivo = p.retencionObjetivo ?? 0.9
  }
  for (const t of tarjetas) {
    const e = estudiante(sub(t.owner))
    // Las tarjetas antiguas no tienen el campo fsrs: se rehace con las columnas sueltas
    const fsrs: Card = t.fsrs
      ? typeof t.fsrs === 'string'
        ? JSON.parse(t.fsrs)
        : (t.fsrs as Card)
      : {
          ...createEmptyCard(new Date(t.fechaInicio ?? Date.now())),
          due: new Date(t.proximaFecha ?? t.fechaInicio ?? Date.now()),
          last_review: t.ultimaFecha ? new Date(t.ultimaFecha) : undefined,
          stability: t.estabilidad ?? 0,
          difficulty: t.dificultad ?? 0,
          scheduled_days: t.intervaloDias ?? 0,
          reps: t.nRepasos ?? 0,
          lapses: t.nFallos ?? 0,
          state: t.estado === 'repaso' ? State.Review : t.estado === 'aprendiendo' ? State.Learning : State.New,
        }
    const local: TarjetaLocal = {
      palabraId: t.palabraId,
      direccion: t.direccion === 'es_de' ? 'es-de' : 'de-es',
      estado: t.estado as Estado,
      fsrs,
      nivel: t.nivel ?? 0,
      fechaInicio: new Date(t.fechaInicio ?? fsrs.due),
      fechaAprendida: t.fechaAprendida ? new Date(t.fechaAprendida) : undefined,
      pendiente: 0,
    }
    e.tarjetas.set(clave(local.palabraId, local.direccion), local)
    const ultima = t.ultimaFecha ? new Date(t.ultimaFecha) : undefined
    if (ultima && (!e.ultima || ultima > e.ultima)) e.ultima = ultima
  }
  return [...porOwner.values()].sort((a, b) => a.nombre.localeCompare(b.nombre))
}

export function Admin({ palabras, volver }: { palabras: Palabra[]; volver: () => void }) {
  const [estudiantes, setEstudiantes] = useState<Estudiante[] | null>(null)
  const [error, setError] = useState('')
  const [elegido, setElegido] = useState<Estudiante | null>(null)
  useEffect(() => {
    cargarEstudiantes().then(setEstudiantes, (e) => setError(String(e)))
  }, [])
  const resumen = useMemo(
    () =>
      new Map(
        (estudiantes ?? []).map((e) => [
          e.owner,
          calcularInforme({ palabras, tarjetas: e.tarjetas, nuevasPorDia: e.nuevasPorDia, ahora: new Date() }),
        ]),
      ),
    [estudiantes, palabras],
  )

  if (elegido)
    return (
      <Informe
        titulo={elegido.nombre}
        palabras={palabras}
        tarjetas={elegido.tarjetas}
        nuevasPorDia={elegido.nuevasPorDia}
        retencionObjetivo={elegido.retencionObjetivo}
        volver={() => setElegido(null)}
      />
    )

  return (
    <main className="informe">
      <header className="cabecera-sesion">
        <button className="enlace" onClick={volver}>
          ← Volver
        </button>
      </header>
      <h1>Estudiantes</h1>
      {error && <p className="error">{error}</p>}
      {!estudiantes && !error && <p className="tenue">Cargando de la nube…</p>}
      {estudiantes && (
        <section className="tarjeta">
          <table className="tabla estudiantes">
            <thead>
              <tr>
                <th>Estudiante</th>
                <th>Aprendidas</th>
                <th>En curso</th>
                <th>Conocidas</th>
                <th>Último repaso</th>
              </tr>
            </thead>
            <tbody>
              {estudiantes.map((e) => {
                const t = resumen.get(e.owner)!.total
                return (
                  <tr key={e.owner} onClick={() => setElegido(e)}>
                    <td>
                      <button className="enlace">{e.nombre}</button>
                    </td>
                    <td>{t.aprendida.toLocaleString('es')}</td>
                    <td>{(t.repaso + t.aprendiendo).toLocaleString('es')}</td>
                    <td>{t.conocida.toLocaleString('es')}</td>
                    <td>{e.ultima ? e.ultima.toLocaleDateString('es') : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="tenue">
            Calculado con las tarjetas de la nube: refleja lo sincronizado. Sin el historial de repasos no hay retención,
            y las palabras marcadas que fallaron el control cuentan como empezadas el día en que se marcaron.
          </p>
        </section>
      )}
    </main>
  )
}
