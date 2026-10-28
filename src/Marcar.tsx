// Marcar las palabras que ya se conocen (docs/diseno_app.md, «Marcar palabras conocidas»).
// Dos modos, en orden de frecuencia: deslizar (móvil) y lista por tramos de 100 (web).
// Cada marca es un repaso «marcado»; desmarcar es otro repaso «marcado» con resultado fallo.

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { clave } from './motor/cola'
import type { Estado, TarjetaLocal } from './motor/reglas'
import type { Palabra } from './palabras'
import { Aleman, Marcado } from './Tarjeta'

export interface CambioMarca {
  palabra: Palabra
  conocida: boolean
}

interface Props {
  palabras: Palabra[] // en orden de estudio
  tarjetas: Map<string, TarjetaLocal>
  marcar: (cambios: CambioMarca[]) => Promise<void>
  cursor: number
  guardarCursor: (orden: number) => void
  volver: () => void
}

/** Estado de una palabra para marcar: el de su tarjeta más avanzada, o nueva. */
function estadoPalabra(tarjetas: Map<string, TarjetaLocal>, id: number): Estado {
  const es = [tarjetas.get(clave(id, 'de-es'))?.estado, tarjetas.get(clave(id, 'es-de'))?.estado]
  for (const e of ['aprendida', 'retirada', 'repaso', 'aprendiendo', 'conocida'] as const) if (es.includes(e)) return e
  return 'nueva'
}

const NOMBRE_ESTADO: Record<Estado, string> = {
  nueva: 'nueva',
  aprendiendo: 'aprendiendo',
  repaso: 'en repaso',
  conocida: 'conocida',
  aprendida: 'aprendida',
  retirada: 'en repaso',
}

export function Marcar(p: Props) {
  const tactil = useMemo(() => window.matchMedia('(pointer: coarse)').matches, [])
  const [modo, setModo] = useState<'deslizar' | 'lista'>(tactil ? 'deslizar' : 'lista')
  return (
    <main className="marcar">
      <header className="cabecera-sesion">
        <button className="enlace" onClick={p.volver}>
          ← Volver
        </button>
        <div className="pestanas">
          <button className={modo === 'deslizar' ? 'activa' : ''} onClick={() => setModo('deslizar')}>
            Deslizar
          </button>
          <button className={modo === 'lista' ? 'activa' : ''} onClick={() => setModo('lista')}>
            Lista
          </button>
        </div>
      </header>
      <p className="tenue">
        Marca las palabras que ya conoces. Cada una tendrá una pregunta de control dentro de 7 a 30 días:
        si la aciertas, pasa a aprendida; si no, entra en el estudio normal.
      </p>
      {modo === 'deslizar' ? <Deslizar {...p} /> : <Lista {...p} />}
    </main>
  )
}

const UMBRAL_PX = 80

function Deslizar({ palabras, tarjetas, marcar, cursor, guardarCursor }: Props) {
  // Candidatas fijadas al entrar: sin estudiar y después de donde se dejó
  const [candidatas] = useState(() =>
    palabras.filter((w) => w.orden > cursor && estadoPalabra(tarjetas, w.id) === 'nueva'),
  )
  const [i, setI] = useState(0)
  const [historial, setHistorial] = useState<boolean[]>([])
  const [traduccion, setTraduccion] = useState(false)
  const [dx, setDx] = useState(0)
  const [ocupado, setOcupado] = useState(false)
  const origen = useRef<number | null>(null)
  const actual = candidatas[i]

  const decidir = useCallback(
    async (conozco: boolean) => {
      if (!actual || ocupado) return
      setOcupado(true)
      try {
        if (conozco) await marcar([{ palabra: actual, conocida: true }])
        guardarCursor(actual.orden)
        setHistorial((h) => [...h, conozco])
        setI((x) => x + 1)
        setTraduccion(false)
        setDx(0)
      } finally {
        setOcupado(false)
      }
    },
    [actual, ocupado, marcar, guardarCursor],
  )

  const deshacer = useCallback(async () => {
    if (!historial.length || ocupado) return
    setOcupado(true)
    try {
      const anterior = candidatas[i - 1]
      if (historial[historial.length - 1]) await marcar([{ palabra: anterior, conocida: false }])
      guardarCursor(candidatas[i - 2]?.orden ?? cursor)
      setHistorial((h) => h.slice(0, -1))
      setI((x) => x - 1)
      setTraduccion(false)
    } finally {
      setOcupado(false)
    }
  }, [historial, ocupado, candidatas, i, marcar, guardarCursor, cursor])

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') decidir(true)
      else if (e.key === 'ArrowLeft') decidir(false)
      else if (e.key === 'Backspace' || e.key === 'z') deshacer()
      else if (e.key === ' ') {
        e.preventDefault()
        setTraduccion((t) => !t)
      }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [decidir, deshacer])

  const abajo = (e: PointerEvent) => {
    origen.current = e.clientX
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const mover = (e: PointerEvent) => {
    if (origen.current !== null) setDx(e.clientX - origen.current)
  }
  const arriba = () => {
    const d = dx
    origen.current = null
    if (Math.abs(d) > UMBRAL_PX) decidir(d > 0)
    else {
      if (Math.abs(d) < 5) setTraduccion((t) => !t) // un toque muestra la traducción
      setDx(0)
    }
  }

  const conocidas = historial.filter(Boolean).length
  return (
    <>
      <p className="tenue">
        Esta vez: <strong>{conocidas}</strong> conocidas · {historial.length - conocidas} no ·{' '}
        {candidatas.length - i} por ver
      </p>
      {actual ? (
        <div
          className={`tarjeta-estudio deslizable ${dx > UMBRAL_PX ? 'si' : dx < -UMBRAL_PX ? 'no' : ''}`}
          style={{ transform: `translateX(${dx}px) rotate(${dx / 25}deg)` }}
          onPointerDown={abajo}
          onPointerMove={mover}
          onPointerUp={arriba}
          onPointerCancel={() => {
            origen.current = null
            setDx(0)
          }}
        >
          <div className="etiquetas">
            <span>{actual.categoria}</span>
            <span>n.º {actual.orden.toLocaleString('es')}</span>
          </div>
          <div className="pregunta">
            <Aleman p={actual} />
            <span className="aviso">
              {traduccion ? <Marcado texto={actual.traduccion_es} /> : 'toca para ver la traducción'}
            </span>
          </div>
        </div>
      ) : (
        <section className="tarjeta fin">
          <h2>No quedan palabras por revisar</h2>
        </section>
      )}
      <div className="botones">
        <button className="fallo" disabled={!actual || ocupado} onClick={() => decidir(false)}>
          ← No
        </button>
        <button disabled={!historial.length || ocupado} onClick={deshacer}>
          Deshacer
        </button>
        <button className="acierto" disabled={!actual || ocupado} onClick={() => decidir(true)}>
          La conozco →
        </button>
      </div>
      {cursor > 0 && i === 0 && (
        <button className="enlace" onClick={() => guardarCursor(0)}>
          Volver a empezar desde la primera palabra (al salir y entrar)
        </button>
      )}
    </>
  )
}

const TAMANO_TRAMO = 100

function Lista({ palabras, tarjetas, marcar }: Props) {
  const nTramos = Math.ceil(palabras.length / TAMANO_TRAMO)
  // Empieza en el primer tramo que aún tiene palabras sin estudiar
  const [tramo, setTramo] = useState(() => {
    const primera = palabras.findIndex((w) => estadoPalabra(tarjetas, w.id) === 'nueva')
    return Math.max(0, Math.floor(primera / TAMANO_TRAMO))
  })
  const filas = palabras.slice(tramo * TAMANO_TRAMO, (tramo + 1) * TAMANO_TRAMO)
  const marcadas = useMemo(
    () => new Set(filas.filter((w) => estadoPalabra(tarjetas, w.id) === 'conocida').map((w) => w.id)),
    [filas, tarjetas],
  )
  const [seleccion, setSeleccion] = useState<Set<number>>(marcadas)
  const [guardando, setGuardando] = useState(false)
  // Al cambiar de tramo se parte de lo que ya está marcado
  useEffect(() => setSeleccion(new Set(marcadas)), [tramo])

  const editables = filas.filter((w) => ['nueva', 'conocida'].includes(estadoPalabra(tarjetas, w.id)))
  const cambios: CambioMarca[] = editables
    .filter((w) => seleccion.has(w.id) !== marcadas.has(w.id))
    .map((w) => ({ palabra: w, conocida: seleccion.has(w.id) }))

  const alternar = (id: number) =>
    setSeleccion((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const guardar = async () => {
    setGuardando(true)
    try {
      await marcar(cambios)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <>
      <div className="navegacion-tramos">
        <button disabled={tramo === 0 || cambios.length > 0} onClick={() => setTramo(tramo - 1)}>
          ←
        </button>
        <span>
          Palabras {(tramo * TAMANO_TRAMO + 1).toLocaleString('es')}–
          {Math.min((tramo + 1) * TAMANO_TRAMO, palabras.length).toLocaleString('es')} (tramo {tramo + 1} de {nTramos})
        </span>
        <button disabled={tramo === nTramos - 1 || cambios.length > 0} onClick={() => setTramo(tramo + 1)}>
          →
        </button>
      </div>
      <div className="acciones-tramo">
        <button onClick={() => setSeleccion(new Set(editables.map((w) => w.id)))}>Marcar todo el tramo</button>
        <button onClick={() => setSeleccion(new Set())}>Desmarcar todo</button>
        <button className="primario" disabled={!cambios.length || guardando} onClick={guardar}>
          Guardar{cambios.length ? ` (${cambios.length})` : ''}
        </button>
      </div>
      {cambios.length > 0 && <p className="tenue">Guarda los cambios antes de pasar a otro tramo.</p>}
      <ul className="lista-marcar">
        {filas.map((w) => {
          const estado = estadoPalabra(tarjetas, w.id)
          const editable = estado === 'nueva' || estado === 'conocida'
          return (
            <li key={w.id} className={editable ? '' : 'bloqueada'}>
              <label>
                <input
                  type="checkbox"
                  disabled={!editable}
                  checked={editable ? seleccion.has(w.id) : true}
                  onChange={() => alternar(w.id)}
                />
                <Aleman p={w} />
                <span className="tenue traduccion">
                  <Marcado texto={w.traduccion_es} />
                </span>
                {estado !== 'nueva' && <span className="estado">{NOMBRE_ESTADO[estado]}</span>}
              </label>
            </li>
          )
        })}
      </ul>
    </>
  )
}
