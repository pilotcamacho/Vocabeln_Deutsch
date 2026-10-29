// Informe de progreso (docs/diseno_app.md, «Informe de progreso»). Los cálculos están en
// src/motor/informe.ts; aquí solo se dibujan. Lo usan el estudiante y la vista de administrador.

import { useMemo, useState } from 'react'
import {
  calcularInforme,
  estadoPalabra,
  ESTADOS_GLOBALES,
  type Desglose,
  type EstadoGlobal,
  type Grupo,
  type Informe as DatosInforme,
} from './motor/informe'
import type { RepasoLocal, TarjetaLocal } from './motor/reglas'
import type { Palabra } from './palabras'
import { Aleman, Marcado } from './Tarjeta'

const NOMBRE: Record<EstadoGlobal, string> = {
  aprendida: 'aprendidas',
  conocida: 'conocidas por controlar',
  repaso: 'en repaso',
  aprendiendo: 'aprendiendo',
  nueva: 'nuevas',
}

const NOMBRE_SINGULAR: Record<EstadoGlobal, string> = {
  aprendida: 'aprendida',
  conocida: 'conocida',
  repaso: 'en repaso',
  aprendiendo: 'aprendiendo',
  nueva: 'nueva',
}

const n = (x: number) => x.toLocaleString('es')
const pct = (x: number, total: number) => (total ? `${Math.round((100 * x) / total)} %` : '—')
const fechaCorta = (d: Date) => d.toLocaleDateString('es', { day: 'numeric', month: 'short' })
const fechaLarga = (d: Date) => d.toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })

interface Props {
  titulo: string
  palabras: Palabra[]
  tarjetas: Map<string, TarjetaLocal>
  repasos?: RepasoLocal[]
  nuevasPorDia: number
  retencionObjetivo: number
  volver: () => void
}

export function Informe(p: Props) {
  const inf = useMemo(
    () =>
      calcularInforme({
        palabras: p.palabras,
        tarjetas: p.tarjetas,
        repasos: p.repasos,
        nuevasPorDia: p.nuevasPorDia,
        ahora: new Date(),
      }),
    [p.palabras, p.tarjetas, p.repasos, p.nuevasPorDia],
  )
  const [vista, setVista] = useState<'informe' | 'palabras'>('informe')
  const validadas = useMemo(() => p.palabras.filter((w) => w.validada).length, [p.palabras])

  return (
    <main className="informe">
      <header className="cabecera-sesion">
        <button className="enlace" onClick={p.volver}>
          ← Volver
        </button>
        <div className="pestanas">
          <button className={vista === 'informe' ? 'activa' : ''} onClick={() => setVista('informe')}>
            Informe
          </button>
          <button className={vista === 'palabras' ? 'activa' : ''} onClick={() => setVista('palabras')}>
            Palabras
          </button>
        </div>
      </header>
      <h1>{p.titulo}</h1>
      {vista === 'informe' ? (
        <>
          <Resumen inf={inf} />
          <Ritmo inf={inf} validadas={validadas} />
          <Carga inf={inf} />
          {inf.retencion && <Retencion inf={inf} objetivo={p.retencionObjetivo} />}
          <Grupos titulo="Por tramos de frecuencia" grupos={inf.tramos} />
          <Grupos titulo="Por categoría" grupos={inf.categorias} />
        </>
      ) : (
        <ListaPalabras palabras={p.palabras} tarjetas={p.tarjetas} />
      )}
    </main>
  )
}

/** Barra apilada por estado; las nuevas son el fondo. */
function Barra({ d, alta }: { d: Desglose; alta?: boolean }) {
  return (
    <div className={`barra ${alta ? 'alta' : ''}`} role="img" aria-label={textoDesglose(d)} title={textoDesglose(d)}>
      {ESTADOS_GLOBALES.filter((e) => e !== 'nueva' && d[e] > 0).map((e) => (
        <span key={e} className={`seg-${e}`} style={{ width: `${(100 * d[e]) / d.total}%` }} />
      ))}
    </div>
  )
}

const textoDesglose = (d: Desglose) =>
  ESTADOS_GLOBALES.filter((e) => d[e] > 0)
    .map((e) => `${n(d[e])} ${NOMBRE[e]}`)
    .join(' · ')

function Leyenda({ d }: { d: Desglose }) {
  return (
    <ul className="leyenda">
      {ESTADOS_GLOBALES.map((e) => (
        <li key={e}>
          <span className={`muestra seg-${e}`} />
          <strong>{n(d[e])}</strong> {NOMBRE[e]}
        </li>
      ))}
    </ul>
  )
}

function Resumen({ inf }: { inf: DatosInforme }) {
  const t = inf.total
  const maxNivel = Math.max(1, ...inf.niveles)
  return (
    <section className="tarjeta">
      <h2>Total de la lista</h2>
      <div className="cifras">
        <div>
          <strong>{n(t.aprendida)}</strong>
          <span>aprendidas</span>
        </div>
        <div>
          <strong>{n(t.repaso + t.aprendiendo)}</strong>
          <span>en curso</span>
        </div>
        <div>
          <strong>{pct(t.total - t.nueva, t.total)}</strong>
          <span>empezadas o conocidas</span>
        </div>
      </div>
      <Barra d={t} alta />
      <Leyenda d={t} />
      {t.repaso > 0 && (
        <>
          <h3>En repaso, por nivel</h3>
          <div className="columnas niveles">
            {inf.niveles.slice(1).map((x, i) => (
              <div key={i} title={`Nivel ${i + 1}: ${n(x)} palabras`}>
                <span className="valor">{x ? n(x) : ''}</span>
                <span className="col seg-repaso" style={{ height: `${(100 * x) / maxNivel}%` }} />
                <span className="eje">{['1 d', '3 d', '7 d', '14 d', '30 d', '60 d', '90 d'][i]}</span>
              </div>
            ))}
          </div>
          <p className="tenue">Intervalo de repaso actual. A partir de 90 días, el siguiente acierto la da por aprendida.</p>
        </>
      )}
    </section>
  )
}

function Ritmo({ inf, validadas }: { inf: DatosInforme; validadas: number }) {
  const max = Math.max(1, ...inf.semanas.map((s) => s.empezadas))
  const ultimas = inf.semanas.slice(-4)
  const suma = (k: 'empezadas' | 'aprendidas' | 'marcadas') => ultimas.reduce((s, x) => s + x[k], 0)
  const proximos = inf.hitos.filter((h) => h.fecha).slice(0, 4)
  const total = inf.hitos[inf.hitos.length - 1]
  return (
    <section className="tarjeta">
      <h2>Ritmo y proyección</h2>
      <p>
        Últimas 4 semanas: <strong>{n(suma('empezadas'))}</strong> palabras empezadas ·{' '}
        <strong>{n(suma('aprendidas'))}</strong> aprendidas
        {suma('marcadas') > 0 && <> · {n(suma('marcadas'))} marcadas como conocidas</>}
      </p>
      <h3>Palabras empezadas por semana</h3>
      <div className="columnas">
        {inf.semanas.map((s, i) => (
          <div
            key={i}
            title={`Semana del ${fechaCorta(s.inicio)}: ${n(s.empezadas)} empezadas, ${n(s.aprendidas)} aprendidas`}
          >
            <span className="valor">{s.empezadas ? n(s.empezadas) : ''}</span>
            <span className="col seg-aprendiendo" style={{ height: `${(100 * s.empezadas) / max}%` }} />
            <span className="eje">{i === inf.semanas.length - 1 ? 'esta' : fechaCorta(s.inicio)}</span>
          </div>
        ))}
      </div>
      <p className="tenue">
        {inf.ritmo.fuente === 'real'
          ? `A tu ritmo real (${inf.ritmo.porDia.toLocaleString('es', { maximumFractionDigits: 1 })} palabras nuevas al día):`
          : `Con tu ajuste de ${n(inf.ritmo.porDia)} palabras nuevas al día (aún no hay una semana de datos):`}
      </p>
      {proximos.length ? (
        <table className="tabla">
          <tbody>
            {proximos.map((h) => (
              <tr key={h.palabras}>
                <td>{h === total ? 'Toda la lista' : `${n(h.palabras)} palabras`}</td>
                <td>{fechaLarga(h.fecha!)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>Ya has empezado toda la lista.</p>
      )}
      <p className="tenue">
        Fecha en que estarían todas empezadas. Cada palabra pasa a aprendida unos 3–4 meses después de empezarla. Por
        ahora solo se pueden estudiar las {n(validadas)} de los tramos revisados.
      </p>
    </section>
  )
}

function Carga({ inf }: { inf: DatosInforme }) {
  const max = Math.max(1, ...inf.carga.map((c) => c.repasos + c.controles))
  const semana = inf.carga.slice(0, 7).reduce((s, c) => s + c.repasos + c.controles, 0)
  const controles = inf.carga.reduce((s, c) => s + c.controles, 0)
  return (
    <section className="tarjeta">
      <h2>Carga prevista</h2>
      <p>
        Hoy: <strong>{n(inf.carga[0].repasos + inf.carga[0].controles)}</strong> · próximos 7 días:{' '}
        <strong>{n(semana)}</strong>
        {controles > 0 && <> · {n(controles)} controles en 30 días</>}
      </p>
      <div className="columnas carga">
        {inf.carga.map((c, i) => (
          <div key={i} title={`${fechaCorta(c.dia)}: ${n(c.repasos)} repasos, ${n(c.controles)} controles`}>
            <span className="col apilada" style={{ height: `${(100 * (c.repasos + c.controles)) / max}%` }}>
              {c.controles > 0 && (
                <span className="seg-conocida" style={{ flex: c.controles }} />
              )}
              {c.repasos > 0 && <span className="seg-repaso" style={{ flex: c.repasos }} />}
            </span>
            <span className="eje">{i % 7 === 0 ? (i ? fechaCorta(c.dia) : 'hoy') : ''}</span>
          </div>
        ))}
      </div>
      <ul className="leyenda">
        <li>
          <span className="muestra seg-repaso" /> repasos
        </li>
        <li>
          <span className="muestra seg-conocida" /> controles
        </li>
      </ul>
      <p className="tenue">
        Solo las palabras ya empezadas o marcadas. Las nuevas de cada día añaden sus propios repasos.
      </p>
    </section>
  )
}

function Retencion({ inf, objetivo }: { inf: DatosInforme; objetivo: number }) {
  const filas = inf.retencion!.filter((r) => r.n > 0)
  const c = inf.controles!
  return (
    <section className="tarjeta">
      <h2>Retención (últimos 30 días)</h2>
      {filas.length ? (
        <table className="tabla">
          <thead>
            <tr>
              <th />
              <th>Real</th>
              <th>Prevista</th>
              <th>Repasos</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((r) => (
              <tr key={r.direccion}>
                <td>{r.direccion === 'de-es' ? 'Reconocer (de → es)' : 'Producir (es → de)'}</td>
                <td>
                  <strong>{pct(r.aciertos, r.n)}</strong>
                </td>
                <td>{Math.round(100 * r.prevista)} %</td>
                <td>{n(r.n)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="tenue">Aún no hay repasos de días anteriores.</p>
      )}
      {c.n > 0 && (
        <p>
          Controles de palabras marcadas: <strong>{pct(c.aciertos, c.n)}</strong> acertados ({n(c.aciertos)} de{' '}
          {n(c.n)})
        </p>
      )}
      <p className="tenue">
        Objetivo: {Math.round(objetivo * 100)} %. Solo cuentan los repasos hechos al menos medio día después del
        anterior. Si la real queda muy por debajo de la prevista, FSRS está siendo optimista contigo; se ajustará con
        tus datos (fase 6).
      </p>
    </section>
  )
}

function Grupos({ titulo, grupos }: { titulo: string; grupos: Grupo[] }) {
  return (
    <section className="tarjeta">
      <h2>{titulo}</h2>
      <ul className="grupos">
        {grupos.map((g) => (
          <li key={g.nombre}>
            <span className="nombre">{g.nombre}</span>
            <Barra d={g.d} />
            <span className="porcentaje" title="Empezadas o conocidas">
              {pct(g.d.total - g.d.nueva, g.d.total)}
            </span>
          </li>
        ))}
      </ul>
      <p className="tenue">El porcentaje cuenta las palabras empezadas o conocidas. Pasa el ratón por una barra para ver el detalle.</p>
    </section>
  )
}

const POR_PAGINA = 100
const normalizar = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')

function ListaPalabras({ palabras, tarjetas }: { palabras: Palabra[]; tarjetas: Map<string, TarjetaLocal> }) {
  const [filtro, setFiltro] = useState<EstadoGlobal | 'todas'>('todas')
  const [texto, setTexto] = useState('')
  const [limite, setLimite] = useState(POR_PAGINA)
  const filas = useMemo(() => {
    const t = normalizar(texto.trim())
    return palabras
      .map((w) => ({ w, e: estadoPalabra(w, tarjetas) }))
      .filter(({ w, e }) => (filtro === 'todas' || e.estado === filtro) && (!t || normalizar(`${w.lema} ${w.traduccion_es}`).includes(t)))
  }, [palabras, tarjetas, filtro, texto])
  const cuenta = useMemo(() => {
    const c = Object.fromEntries(ESTADOS_GLOBALES.map((e) => [e, 0])) as Record<EstadoGlobal, number>
    for (const w of palabras) c[estadoPalabra(w, tarjetas).estado]++
    return c
  }, [palabras, tarjetas])

  return (
    <>
      <div className="filtros">
        {(['todas', ...ESTADOS_GLOBALES] as const).map((e) => (
          <button
            key={e}
            className={filtro === e ? 'activa' : ''}
            onClick={() => {
              setFiltro(e)
              setLimite(POR_PAGINA)
            }}
          >
            {e === 'todas' ? 'Todas' : NOMBRE_SINGULAR[e]} {e !== 'todas' && <span className="tenue">{n(cuenta[e])}</span>}
          </button>
        ))}
      </div>
      <input
        className="buscador"
        type="search"
        placeholder="Buscar en alemán o en español"
        value={texto}
        onChange={(ev) => {
          setTexto(ev.target.value)
          setLimite(POR_PAGINA)
        }}
      />
      <p className="tenue">{n(filas.length)} palabras</p>
      <ul className="lista-marcar lista-palabras">
        {filas.slice(0, limite).map(({ w, e }) => (
          <li key={w.id}>
            <span className="orden">{n(w.orden)}</span>
            <Aleman p={w} />
            <span className="tenue traduccion">
              <Marcado texto={w.traduccion_es} />
            </span>
            <span className="estado">
              <span className={`muestra seg-${e.estado}`} />
              {NOMBRE_SINGULAR[e.estado]}
              {e.estado === 'repaso' && ` · n${e.nivel}`}
              {e.proxima && ` · ${fechaCorta(e.proxima)}`}
            </span>
          </li>
        ))}
      </ul>
      {filas.length > limite && (
        <button className="ancho" onClick={() => setLimite(limite + POR_PAGINA * 5)}>
          Mostrar más
        </button>
      )}
    </>
  )
}
