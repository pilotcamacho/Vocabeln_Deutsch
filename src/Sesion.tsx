// Sesión de estudio: recorre la cola del día. Las tarjetas que siguen en aprendizaje (pasos
// de 1 y 10 minutos) vuelven a entrar más adelante en la misma sesión.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ItemCola } from './motor/cola'
import { finDelDia } from './motor/cola'
import type { Resultado, TarjetaLocal } from './motor/reglas'
import { Tarjeta } from './Tarjeta'

/** Ritmo aproximado, para recolocar una tarjeta cuando le toque según su paso de aprendizaje. */
const TARJETAS_POR_MINUTO = 4

interface Props {
  inicial: ItemCola[]
  responder: (item: ItemCola, resultado: Resultado, tiempoMs: number) => Promise<TarjetaLocal>
  terminar: () => void
}

export function Sesion({ inicial, responder, terminar }: Props) {
  const [cola, setCola] = useState(inicial)
  const [i, setI] = useState(0)
  const [mostrada, setMostrada] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [hechas, setHechas] = useState({ aciertos: 0, fallos: 0 })
  const inicio = useRef(Date.now())
  const tiempo = useRef(0)
  const item = cola[i]

  const mostrar = useCallback(() => {
    if (!item || mostrada) return
    tiempo.current = Date.now() - inicio.current
    setMostrada(true)
  }, [item, mostrada])

  const contestar = useCallback(
    async (resultado: Resultado) => {
      if (!item || !mostrada || ocupado) return
      setOcupado(true)
      try {
        const t = await responder(item, resultado, tiempo.current)
        const due = new Date(t.fsrs.due)
        let siguiente = cola
        if (t.estado === 'aprendiendo' && due < finDelDia(new Date())) {
          const minutos = Math.max(0, (due.getTime() - Date.now()) / 60_000)
          const pos = Math.min(cola.length, i + 1 + Math.max(2, Math.round(minutos * TARJETAS_POR_MINUTO)))
          siguiente = [...cola.slice(0, pos), { ...item, motivo: 'repaso' as const }, ...cola.slice(pos)]
        }
        setCola(siguiente)
        setHechas((h) => (resultado === 'acierto' ? { ...h, aciertos: h.aciertos + 1 } : { ...h, fallos: h.fallos + 1 }))
        setI(i + 1)
        setMostrada(false)
        inicio.current = Date.now()
      } finally {
        setOcupado(false)
      }
    },
    [item, mostrada, ocupado, responder, cola, i],
  )

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        if (!mostrada) mostrar()
      } else if (e.key === '1' || e.key === 'ArrowLeft') contestar('fallo')
      else if (e.key === '2' || e.key === 'ArrowRight') contestar('acierto')
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [mostrar, contestar, mostrada])

  if (!item) {
    return (
      <main className="sesion">
        <section className="tarjeta fin">
          <h2>¡Listo por hoy!</h2>
          <p>
            {hechas.aciertos + hechas.fallos} respuestas · {hechas.aciertos} aciertos · {hechas.fallos} fallos
          </p>
          <button className="primario" onClick={terminar}>
            Volver
          </button>
        </section>
      </main>
    )
  }

  return (
    <main className="sesion">
      <header className="cabecera-sesion">
        <button className="enlace" onClick={terminar}>
          ← Salir
        </button>
        <span className="tenue">quedan {cola.length - i}</span>
      </header>
      <div className="progreso">
        <div style={{ width: `${(100 * i) / cola.length}%` }} />
      </div>

      <Tarjeta
        palabra={item.palabra}
        direccion={item.direccion}
        nueva={item.motivo !== 'repaso'}
        mostrada={mostrada}
      />

      <div className="botones">
        {!mostrada ? (
          <button className="primario ancho" onClick={mostrar}>
            Mostrar respuesta
          </button>
        ) : (
          <>
            <button className="fallo" disabled={ocupado} onClick={() => contestar('fallo')}>
              No lo sabía
            </button>
            <button className="acierto" disabled={ocupado} onClick={() => contestar('acierto')}>
              Lo sabía
            </button>
          </>
        )}
      </div>
    </main>
  )
}
