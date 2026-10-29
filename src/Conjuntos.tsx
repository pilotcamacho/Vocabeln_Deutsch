// Conjuntos (docs/diseno_app.md, «Conjunto» y «Crear un conjunto a partir de un texto»).
// Lista de conjuntos propios y públicos, crear uno desde un texto (se lematiza en el
// dispositivo), priorizarlo en la cola y su informe con la cobertura del texto.

import { useMemo, useState } from 'react'
import {
  borrarConjunto,
  cambiarPublico,
  cargarFormas,
  crearConjunto,
  type Conjunto,
  type NuevoConjunto,
  type TipoConjunto,
} from './datos/conjuntos'
import { Barra, Informe } from './Informe'
import { cobertura, ESTADOS_GLOBALES, type Cobertura, type EstadoGlobal } from './motor/informe'
import { aPalabras, lematizar } from './motor/lematizar'
import type { RepasoLocal, TarjetaLocal } from './motor/reglas'
import type { Palabra } from './palabras'

const TIPOS: Record<TipoConjunto, string> = { texto: 'Texto', libro: 'Libro', tema: 'Tema' }
const n = (x: number) => x.toLocaleString('es')
const pct = (x: number, total: number) => (total ? `${Math.round((100 * x) / total)} %` : '—')

interface Props {
  conjuntos: Conjunto[]
  palabras: Palabra[]
  porId: Map<number, Palabra>
  tarjetas: Map<string, TarjetaLocal>
  admin: boolean
  enLinea: boolean
  activoId: string | null
  nuevasPorDia: number
  retencionObjetivo: number
  activar: (id: string | null) => Promise<void>
  recargar: () => Promise<void>
  cargarRepasos: () => Promise<RepasoLocal[]>
  marcar: (palabras: Palabra[]) => void
  volver: () => void
}

export function Conjuntos(p: Props) {
  const [vista, setVista] = useState<{ tipo: 'lista' } | { tipo: 'nuevo' } | { tipo: 'informe'; c: Conjunto; repasos: RepasoLocal[] }>(
    { tipo: 'lista' },
  )

  if (vista.tipo === 'nuevo')
    return (
      <Nuevo
        porId={p.porId}
        volver={() => setVista({ tipo: 'lista' })}
        guardado={async () => {
          await p.recargar()
          setVista({ tipo: 'lista' })
        }}
      />
    )

  if (vista.tipo === 'informe') {
    const ids = new Set(vista.c.palabras.map(([id]) => id))
    const palabras = p.palabras.filter((w) => ids.has(w.id))
    return (
      <Informe
        titulo={vista.c.nombre}
        todo="Todo el conjunto"
        palabras={palabras}
        tarjetas={p.tarjetas}
        repasos={vista.repasos.filter((r) => ids.has(r.palabraId))}
        nuevasPorDia={p.nuevasPorDia}
        retencionObjetivo={p.retencionObjetivo}
        volver={() => setVista({ tipo: 'lista' })}
        extra={
          <section className="tarjeta">
            <h2>Cobertura del texto</h2>
            <BarraCobertura c={cobertura(vista.c.palabras, p.porId, p.tarjetas, vista.c.nTokens)} detalle />
            <button className="ancho" onClick={() => p.marcar(palabras)}>
              Marcar las que ya conozco de este conjunto
            </button>
          </section>
        }
      />
    )
  }

  return (
    <main className="informe">
      <header className="cabecera-sesion">
        <button className="enlace" onClick={p.volver}>
          ← Volver
        </button>
        <button className="primario" disabled={!p.enLinea} onClick={() => setVista({ tipo: 'nuevo' })}>
          Nuevo conjunto
        </button>
      </header>
      <h1>Conjuntos</h1>
      <p className="tenue">
        Un libro, un tema o cualquier texto. Al priorizar un conjunto, sus palabras nuevas pasan delante en la sesión
        diaria (siempre después de sus raíces).
      </p>
      {!p.enLinea && <p className="tenue">Sin conexión: se muestran los conjuntos guardados en este dispositivo.</p>}
      {!p.conjuntos.length && <p>Aún no hay conjuntos. Crea uno pegando un texto en alemán.</p>}
      {p.conjuntos.map((c) => (
        <Fila
          key={c.id}
          c={c}
          {...p}
          verInforme={async () => setVista({ tipo: 'informe', c, repasos: await p.cargarRepasos() })}
        />
      ))}
    </main>
  )
}

function Fila(p: Props & { c: Conjunto; verInforme: () => void }) {
  const { c } = p
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const cob = useMemo(() => cobertura(c.palabras, p.porId, p.tarjetas, c.nTokens), [c, p.porId, p.tarjetas])
  const activo = p.activoId === c.id
  const accion = (fn: () => Promise<void>) => async () => {
    setOcupado(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(String(e))
    } finally {
      setOcupado(false)
    }
  }
  return (
    <section className={`tarjeta conjunto ${activo ? 'activo' : ''}`}>
      <div className="etiquetas">
        <span>{TIPOS[c.tipo]}</span>
        <span>{c.publico ? 'público' : 'privado'}</span>
        {activo && <span className="nueva">priorizado</span>}
      </div>
      <h2>{c.nombre}</h2>
      {c.descripcion && <p className="tenue">{c.descripcion}</p>}
      <p>
        <strong>{n(c.palabras.length)}</strong> palabras de la lista · {n(c.nTokens)} en el texto
      </p>
      <BarraCobertura c={cob} />
      <div className="acciones-tramo">
        <button onClick={p.verInforme}>Informe</button>
        <button disabled={!p.enLinea || ocupado} onClick={accion(() => p.activar(activo ? null : c.id))}>
          {activo ? 'Dejar de priorizar' : 'Priorizar'}
        </button>
        {p.admin && (
          <button
            disabled={!p.enLinea || ocupado}
            onClick={accion(async () => {
              await cambiarPublico(c.id, !c.publico)
              await p.recargar()
            })}
          >
            {c.publico ? 'Hacer privado' : 'Hacer público'}
          </button>
        )}
        {(c.propio || p.admin) && (
          <button
            className="peligro"
            disabled={!p.enLinea || ocupado}
            onClick={accion(async () => {
              if (!window.confirm(`¿Borrar «${c.nombre}»? Tu progreso en sus palabras no se pierde.`)) return
              if (activo) await p.activar(null)
              await borrarConjunto(c.id)
              await p.recargar()
            })}
          >
            Borrar
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  )
}

const NOMBRE_COB: Record<EstadoGlobal, string> = {
  aprendida: 'aprendidas',
  conocida: 'conocidas',
  repaso: 'en repaso',
  aprendiendo: 'aprendiendo',
  nueva: 'sin estudiar',
}

/** Cobertura: % del texto (contando cada aparición) según el estado de sus palabras. */
function BarraCobertura({ c, detalle }: { c: Cobertura; detalle?: boolean }) {
  const t = c.tokens
  const cubierto = t.aprendida + t.conocida + t.repaso
  return (
    <>
      <p>
        Entiendes el <strong>{pct(cubierto, c.nTokens)}</strong> del texto (aprendidas, conocidas y en repaso) ·{' '}
        <span className="tenue">{pct(c.fuera, c.nTokens)} son palabras fuera de la lista</span>
      </p>
      <Barra d={{ ...t, total: c.nTokens }} />
      {detalle && (
        <>
          <ul className="leyenda">
            {ESTADOS_GLOBALES.map((e) => (
              <li key={e}>
                <span className={`muestra seg-${e}`} />
                <strong>{pct(t[e], c.nTokens)}</strong> {NOMBRE_COB[e]}
              </li>
            ))}
          </ul>
          <p className="tenue">
            Porcentajes sobre todas las palabras del texto ({n(c.nTokens)}), contando cada aparición. Las de fuera de la
            lista son sobre todo artículos, pronombres, conjunciones y nombres propios: no se estudian aparte.
          </p>
        </>
      )}
    </>
  )
}

interface Analisis {
  palabras: [number, number][]
  nTokens: number
  nTokensEnLista: number
  fuera: [string, number][]
}

function Nuevo({ porId, volver, guardado }: { porId: Map<number, Palabra>; volver: () => void; guardado: () => Promise<void> }) {
  const [nombre, setNombre] = useState('')
  const [tipo, setTipo] = useState<TipoConjunto>('texto')
  const [descripcion, setDescripcion] = useState('')
  const [texto, setTexto] = useState('')
  const [analisis, setAnalisis] = useState<Analisis | null>(null)
  const [ocupado, setOcupado] = useState<'' | 'analizando' | 'guardando'>('')
  const [error, setError] = useState('')

  const analizar = async () => {
    setOcupado('analizando')
    setError('')
    try {
      const formas = await cargarFormas()
      const l = lematizar(texto, formas)
      const palabras = aPalabras(l, formas, (id) => porId.get(id)?.significado_n)
      setAnalisis({
        palabras,
        nTokens: l.total,
        nTokensEnLista: palabras.reduce((s, [, k]) => s + k, 0),
        fuera: [...l.fuera.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15),
      })
    } catch (e) {
      setError(String(e))
    } finally {
      setOcupado('')
    }
  }

  const guardar = async () => {
    if (!analisis) return
    setOcupado('guardando')
    setError('')
    try {
      const nuevo: NuevoConjunto = {
        nombre: nombre.trim(),
        tipo,
        descripcion: descripcion.trim() || undefined,
        nTokens: analisis.nTokens,
        nTokensEnLista: analisis.nTokensEnLista,
        palabras: analisis.palabras,
      }
      await crearConjunto(nuevo)
      await guardado()
    } catch (e) {
      setError(String(e))
      setOcupado('')
    }
  }

  const leerArchivo = async (archivo: File | undefined) => {
    if (!archivo) return
    setTexto(await archivo.text())
    setAnalisis(null)
    if (!nombre) setNombre(archivo.name.replace(/\.[^.]+$/, ''))
  }

  return (
    <main className="informe nuevo-conjunto">
      <header className="cabecera-sesion">
        <button className="enlace" onClick={volver}>
          ← Volver
        </button>
      </header>
      <h1>Nuevo conjunto</h1>
      <section className="tarjeta">
        <label className="campo-texto">
          Nombre
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="p. ej. Der Vorleser, cap. 1" />
        </label>
        <label className="campo-texto">
          Tipo
          <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoConjunto)}>
            {Object.entries(TIPOS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="campo-texto">
          Descripción (opcional)
          <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
        </label>
        <label className="campo-texto">
          Texto en alemán
          <textarea
            rows={10}
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value)
              setAnalisis(null)
            }}
            placeholder="Pega aquí el texto, o elige un archivo .txt"
          />
        </label>
        <input type="file" accept=".txt,text/plain" onChange={(e) => void leerArchivo(e.target.files?.[0])} />
        <p className="tenue">
          El texto no sale de tu dispositivo: solo se guarda la lista de palabras y cuántas veces aparece cada una.
        </p>
        <button className="ancho" disabled={!texto.trim() || !!ocupado} onClick={analizar}>
          {ocupado === 'analizando' ? 'Analizando…' : 'Analizar el texto'}
        </button>
      </section>

      {analisis && (
        <section className="tarjeta">
          <h2>Resultado</h2>
          <p>
            <strong>{n(analisis.nTokens)}</strong> palabras en el texto ·{' '}
            <strong>{pct(analisis.nTokensEnLista, analisis.nTokens)}</strong> están en la lista ·{' '}
            <strong>{n(analisis.palabras.length)}</strong> palabras distintas de la lista
          </p>
          <p className="tenue">
            Las más frecuentes:{' '}
            {analisis.palabras
              .slice(0, 12)
              .map(([id, k]) => `${porId.get(id)?.lema} ×${k}`)
              .join(', ')}
          </p>
          {analisis.fuera.length > 0 && (
            <p className="tenue">
              Fuera de la lista: {analisis.fuera.map(([w, k]) => `${w} ×${k}`).join(', ')}
            </p>
          )}
          <p className="tenue">
            Cada palabra se enlaza con su primer significado. Los verbos separables se reconocen cuando la partícula está
            al final de la frase (kommt … an → ankommen).
          </p>
          <button
            className="primario ancho"
            disabled={!nombre.trim() || !analisis.palabras.length || !!ocupado}
            onClick={guardar}
          >
            {ocupado === 'guardando' ? 'Guardando…' : nombre.trim() ? 'Guardar el conjunto' : 'Ponle un nombre para guardarlo'}
          </button>
        </section>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  )
}
