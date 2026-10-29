import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react'
import { fetchAuthSession, fetchUserAttributes, getCurrentUser } from 'aws-amplify/auth'
import { abrirBase, guardarMeta, guardarRepasos, idDispositivo, leerMeta, type BaseLocal } from './datos/base'
import { ajustesLocales, cambiarAjustes, traerPerfil, type Ajustes } from './datos/perfil'
import { sincronizar, type Usuario } from './datos/sincronizar'
import { clave, construirCola, inicioDelDia, type ItemCola } from './motor/cola'
import {
  direccionControl,
  planificador,
  responder,
  VERSION_ALGORITMO,
  type RepasoLocal,
  type Resultado,
  type TarjetaLocal,
} from './motor/reglas'
import { Admin } from './Admin'
import { Informe } from './Informe'
import { Marcar, type CambioMarca } from './Marcar'
import { estadoPalabra } from './motor/informe'
import { cargarPalabras, type Contenido, type Palabra } from './palabras'
import { Sesion } from './Sesion'

export default function App() {
  const { authStatus } = useAuthenticator((c) => [c.authStatus])
  if (authStatus !== 'authenticated') {
    return (
      <main className="acceso">
        <h1>Vocabeln Deutsch</h1>
        <Authenticator signUpAttributes={['email']} />
      </main>
    )
  }
  return <Principal />
}

interface Carga {
  usuario: Usuario
  db: BaseLocal
  contenido: Contenido
  porId: Map<number, Palabra>
  dispositivo: string
}

type EstadoSync = { tipo: 'parado' } | { tipo: 'sincronizando' } | { tipo: 'error'; mensaje: string }

function Principal() {
  const { signOut } = useAuthenticator()
  const [carga, setCarga] = useState<Carga | null>(null)
  const [ajustes, setAjustes] = useState<Ajustes | null>(null)
  const [tarjetas, setTarjetas] = useState<Map<string, TarjetaLocal>>(new Map())
  const [correo, setCorreo] = useState('')
  const [admin, setAdmin] = useState(false)
  const [sesion, setSesion] = useState<ItemCola[] | null>(null)
  const [marcando, setMarcando] = useState(false)
  // Informe propio (con los repasos locales) o vista de administrador
  const [informe, setInforme] = useState<RepasoLocal[] | 'admin' | null>(null)
  const [cursorMarcar, setCursorMarcar] = useState(0)
  const [sync, setSync] = useState<EstadoSync>({ tipo: 'parado' })
  const [sinSubir, setSinSubir] = useState(0)
  const [ultimaSync, setUltimaSync] = useState<string | null>(null)
  const [error, setError] = useState('')
  const enLinea = useEnLinea()
  const f = useMemo(() => planificador(ajustes?.retencionObjetivo), [ajustes?.retencionObjetivo])

  const recargarTarjetas = useCallback(async (db: BaseLocal) => {
    const todas = await db.tarjetas.toArray()
    setTarjetas(new Map(todas.map((t) => [clave(t.palabraId, t.direccion), t])))
    setSinSubir(await db.repasos.where('enviado').equals(0).count())
    setUltimaSync(await leerMeta<string | null>(db, 'ultimaSync', null))
  }, [])

  // Carga inicial: todo lo local primero (funciona sin conexión), después la nube
  useEffect(() => {
    ;(async () => {
      try {
        const { userId, username } = await getCurrentUser()
        const db = abrirBase(userId)
        const contenido = await cargarPalabras()
        const porId = new Map(contenido.palabras.map((p) => [p.id, p]))
        setAjustes(await ajustesLocales(db))
        setCorreo(await leerMeta(db, 'correo', ''))
        setAdmin(await leerMeta(db, 'admin', false))
        setCursorMarcar(await leerMeta(db, 'cursorMarcar', 0))
        await recargarTarjetas(db)
        setCarga({ usuario: { userId, username }, db, contenido, porId, dispositivo: await idDispositivo(db) })
      } catch (e) {
        setError(String(e))
      }
    })()
  }, [recargarTarjetas])

  const sincronizarAhora = useCallback(async () => {
    if (!carga || !navigator.onLine) return
    setSync({ tipo: 'sincronizando' })
    try {
      await sincronizar(carga.db, carga.usuario, f)
      await recargarTarjetas(carga.db)
      setSync({ tipo: 'parado' })
    } catch (e) {
      setSync({ tipo: 'error', mensaje: String(e) })
    }
  }, [carga, f, recargarTarjetas])

  // Con conexión: datos del usuario, perfil y sincronización
  useEffect(() => {
    if (!carga || !enLinea) return
    ;(async () => {
      try {
        const atributos = await fetchUserAttributes()
        const sesionAuth = await fetchAuthSession()
        const grupos = (sesionAuth.tokens?.idToken?.payload['cognito:groups'] as string[]) ?? []
        setCorreo(atributos.email ?? '')
        setAdmin(grupos.includes('admin'))
        await guardarMeta(carga.db, 'correo', atributos.email ?? '')
        await guardarMeta(carga.db, 'admin', grupos.includes('admin'))
        setAjustes(await traerPerfil(carga.db, (atributos.email ?? '').split('@')[0]))
      } catch (e) {
        setError(String(e))
      }
      await sincronizarAhora()
    })()
    // sincronizarAhora cambia con los ajustes; solo se quiere al cargar y al recuperar la red
  }, [carga, enLinea])

  // Tras responder, se sincroniza a los pocos segundos (en lotes, para gastar menos)
  const temporizador = useRef<number | undefined>(undefined)
  const programarSync = useCallback(() => {
    window.clearTimeout(temporizador.current)
    temporizador.current = window.setTimeout(() => void sincronizarAhora(), 15_000)
  }, [sincronizarAhora])

  const contestar = useCallback(
    async (item: ItemCola, resultado: Resultado, tiempoMs: number): Promise<TarjetaLocal> => {
      if (!carga) throw new Error('Sin cargar')
      const fecha = new Date()
      const id = item.palabra.id
      const actuales = {
        'de-es': tarjetas.get(clave(id, 'de-es')),
        'es-de': tarjetas.get(clave(id, 'es-de')),
      }
      const tipo = item.motivo === 'control' ? 'control' : 'estudio'
      const r = responder(f, actuales, id, { direccion: item.direccion, resultado, fecha, tipo })
      await guardarRepasos(
        carga.db,
        [
          {
            id: crypto.randomUUID(),
            palabraId: id,
            direccion: item.direccion,
            fechaHora: fecha.toISOString(),
            resultado,
            tipo,
            tiempoMs,
            diasDesdeAnterior: r.diasDesdeAnterior,
            rPrevista: r.rPrevista,
            versionAlgoritmo: VERSION_ALGORITMO,
            dispositivo: carga.dispositivo,
            enviado: 0,
          },
        ],
        r.cambiadas,
      )
      setTarjetas((m) => {
        const n = new Map(m)
        for (const t of r.cambiadas) n.set(clave(t.palabraId, t.direccion), t)
        return n
      })
      setSinSubir((x) => x + 1)
      programarSync()
      return r.cambiadas[0]
    },
    [carga, tarjetas, f, programarSync],
  )

  // Marcar o desmarcar palabras como conocidas: un repaso «marcado» por palabra
  const marcarPalabras = useCallback(
    async (cambios: CambioMarca[]) => {
      if (!carga) return
      const fecha = new Date()
      const local = new Map(tarjetas)
      const repasos: RepasoLocal[] = []
      const cambiadas: TarjetaLocal[] = []
      for (const { palabra, conocida } of cambios) {
        const id = crypto.randomUUID()
        const direccion = direccionControl(palabra)
        const actuales = {
          'de-es': local.get(clave(palabra.id, 'de-es')),
          'es-de': local.get(clave(palabra.id, 'es-de')),
        }
        const resultado = conocida ? 'acierto' : 'fallo'
        const r = responder(f, actuales, palabra.id, { direccion, resultado, fecha, tipo: 'marcado', id })
        if (!r.cambiadas.length) continue
        for (const t of r.cambiadas) {
          local.set(clave(t.palabraId, t.direccion), t)
          cambiadas.push(t)
        }
        repasos.push({
          id,
          palabraId: palabra.id,
          direccion,
          fechaHora: fecha.toISOString(),
          resultado,
          tipo: 'marcado',
          versionAlgoritmo: VERSION_ALGORITMO,
          dispositivo: carga.dispositivo,
          enviado: 0,
        })
      }
      if (!repasos.length) return
      await guardarRepasos(carga.db, repasos, cambiadas)
      setTarjetas(local)
      setSinSubir((x) => x + repasos.length)
      programarSync()
    },
    [carga, tarjetas, f, programarSync],
  )

  const calcularCola = useCallback(async () => {
    if (!carga || !ajustes) return []
    const ahora = new Date()
    const repasosHoy = await carga.db.repasos.where('fechaHora').aboveOrEqual(inicioDelDia(ahora).toISOString()).toArray()
    return construirCola({
      palabras: carga.contenido.palabras,
      porId: carga.porId,
      tarjetas,
      repasosHoy,
      nuevasPorDia: ajustes.nuevasPorDia,
      ahora,
      f,
    })
  }, [carga, ajustes, tarjetas, f])

  const [colaHoy, setColaHoy] = useState<ItemCola[] | null>(null)
  useEffect(() => {
    if (!sesion && !marcando && !informe) calcularCola().then(setColaHoy)
  }, [calcularCola, sesion, marcando, informe])

  if (error && !carga) return <main><p className="error">{error}</p></main>
  if (!carga || !ajustes) return <main><p className="tenue">Cargando…</p></main>

  if (sesion) {
    return (
      <Sesion
        inicial={sesion}
        responder={contestar}
        terminar={() => {
          setSesion(null)
          void sincronizarAhora()
        }}
      />
    )
  }

  if (marcando) {
    return (
      <Marcar
        palabras={carga.contenido.palabras}
        tarjetas={tarjetas}
        marcar={marcarPalabras}
        cursor={cursorMarcar}
        guardarCursor={(orden) => void guardarMeta(carga.db, 'cursorMarcar', orden).then(() => setCursorMarcar(orden))}
        volver={() => {
          setMarcando(false)
          void sincronizarAhora()
        }}
      />
    )
  }

  if (informe === 'admin') return <Admin palabras={carga.contenido.palabras} volver={() => setInforme(null)} />
  if (informe) {
    return (
      <Informe
        titulo="Tu progreso"
        palabras={carga.contenido.palabras}
        tarjetas={tarjetas}
        repasos={informe}
        nuevasPorDia={ajustes.nuevasPorDia}
        retencionObjetivo={ajustes.retencionObjetivo}
        volver={() => setInforme(null)}
      />
    )
  }

  return (
    <Inicio
      carga={carga}
      ajustes={ajustes}
      tarjetas={tarjetas}
      cola={colaHoy}
      correo={correo}
      admin={admin}
      enLinea={enLinea}
      sync={sync}
      sinSubir={sinSubir}
      ultimaSync={ultimaSync}
      error={error}
      estudiar={() => colaHoy?.length && setSesion(colaHoy)}
      marcar={() => setMarcando(true)}
      verInforme={() => void carga.db.repasos.toArray().then(setInforme)}
      verEstudiantes={() => setInforme('admin')}
      sincronizar={sincronizarAhora}
      guardarAjustes={async (a) => {
        await cambiarAjustes(carga.db, a)
        setAjustes(a)
      }}
      salir={signOut}
    />
  )
}

interface PropsInicio {
  carga: Carga
  ajustes: Ajustes
  tarjetas: Map<string, TarjetaLocal>
  cola: ItemCola[] | null
  correo: string
  admin: boolean
  enLinea: boolean
  sync: EstadoSync
  sinSubir: number
  ultimaSync: string | null
  error: string
  estudiar: () => void
  marcar: () => void
  verInforme: () => void
  verEstudiantes: () => void
  sincronizar: () => void
  guardarAjustes: (a: Ajustes) => Promise<void>
  salir: () => void
}

function Inicio(p: PropsInicio) {
  const { palabras } = p.carga.contenido
  const progreso = useMemo(() => {
    let aprendidas = 0
    let enCurso = 0
    let conocidas = 0
    for (const w of palabras) {
      const { estado } = estadoPalabra(w, p.tarjetas)
      if (estado === 'aprendida') aprendidas++
      else if (estado === 'conocida') conocidas++
      else if (estado !== 'nueva') enCurso++
    }
    return { aprendidas, enCurso, conocidas }
  }, [palabras, p.tarjetas])

  const cuenta = (m: ItemCola['motivo']) => p.cola?.filter((x) => x.motivo === m).length ?? 0
  const validadas = palabras.filter((w) => w.validada).length

  return (
    <main className="inicio">
      <header>
        <h1>Vocabeln Deutsch</h1>
        <span className={p.enLinea ? 'red si' : 'red no'}>{p.enLinea ? 'En línea' : 'Sin conexión'}</span>
      </header>

      <section className="tarjeta">
        <h2>Hoy</h2>
        {p.cola ? (
          <>
            <p>
              <strong>{cuenta('repaso')}</strong> repasos · <strong>{cuenta('nueva')}</strong> nuevas ·{' '}
              <strong>{cuenta('produccion')}</strong> para producir
              {cuenta('control') > 0 && (
                <>
                  {' '}
                  · <strong>{cuenta('control')}</strong> controles
                </>
              )}
            </p>
            <button className="primario ancho" disabled={!p.cola.length} onClick={p.estudiar}>
              {p.cola.length ? 'Estudiar' : 'Nada pendiente por hoy'}
            </button>
          </>
        ) : (
          <p className="tenue">Calculando…</p>
        )}
      </section>

      <section className="tarjeta">
        <h2>Progreso</h2>
        <p>
          <strong>{progreso.aprendidas.toLocaleString('es')}</strong> aprendidas ·{' '}
          <strong>{progreso.enCurso.toLocaleString('es')}</strong> en curso ·{' '}
          <strong>{progreso.conocidas.toLocaleString('es')}</strong> conocidas por controlar · de{' '}
          {palabras.length.toLocaleString('es')}
        </p>
        <p className="tenue">{validadas.toLocaleString('es')} listas para estudiar (tramos revisados)</p>
        <button className="ancho" onClick={p.verInforme}>
          Ver informe y lista de palabras
        </button>
        <button className="ancho" onClick={p.marcar}>
          Marcar palabras que ya conozco
        </button>
      </section>

      <section className="tarjeta">
        <h2>Sincronización</h2>
        <p>
          {p.sync.tipo === 'sincronizando'
            ? 'Sincronizando…'
            : p.sinSubir
              ? `${p.sinSubir} repasos por subir`
              : 'Todo subido'}
          {p.ultimaSync && <span className="tenue"> · última: {new Date(p.ultimaSync).toLocaleString('es')}</span>}
        </p>
        {p.sync.tipo === 'error' && <p className="error">{p.sync.mensaje}</p>}
        <button disabled={!p.enLinea || p.sync.tipo === 'sincronizando'} onClick={p.sincronizar}>
          Sincronizar ahora
        </button>
      </section>

      <AjustesForm ajustes={p.ajustes} enLinea={p.enLinea} guardar={p.guardarAjustes} />

      <section className="tarjeta">
        <p>{p.correo}</p>
        <p className="tenue">
          {p.admin ? 'Administrador' : 'Estudiante'} · contenido {p.carga.contenido.version}
        </p>
        {p.admin && (
          <button className="ancho" disabled={!p.enLinea} onClick={p.verEstudiantes}>
            Progreso de los estudiantes
          </button>
        )}
        <button className="ancho" onClick={p.salir}>
          Cerrar sesión
        </button>
      </section>
      {p.error && <p className="error">{p.error}</p>}
    </main>
  )
}

function AjustesForm({ ajustes, enLinea, guardar }: { ajustes: Ajustes; enLinea: boolean; guardar: (a: Ajustes) => Promise<void> }) {
  const [nuevas, setNuevas] = useState(ajustes.nuevasPorDia)
  const [mensaje, setMensaje] = useState('')
  useEffect(() => setNuevas(ajustes.nuevasPorDia), [ajustes.nuevasPorDia])
  return (
    <section className="tarjeta">
      <h2>Ajustes</h2>
      <label className="campo">
        Palabras nuevas por día
        <input
          type="number"
          min={0}
          max={100}
          value={nuevas}
          onChange={(e) => setNuevas(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
        />
      </label>
      <button
        disabled={!enLinea || nuevas === ajustes.nuevasPorDia}
        onClick={async () => {
          try {
            await guardar({ ...ajustes, nuevasPorDia: nuevas })
            setMensaje('Guardado')
          } catch (e) {
            setMensaje(String(e))
          }
        }}
      >
        Guardar
      </button>
      {!enLinea && <p className="tenue">Los ajustes se cambian con conexión.</p>}
      {mensaje && <p className="tenue">{mensaje}</p>}
    </section>
  )
}

function useEnLinea() {
  const [enLinea, setEnLinea] = useState(navigator.onLine)
  useEffect(() => {
    const cambiar = () => setEnLinea(navigator.onLine)
    window.addEventListener('online', cambiar)
    window.addEventListener('offline', cambiar)
    return () => {
      window.removeEventListener('online', cambiar)
      window.removeEventListener('offline', cambiar)
    }
  }, [])
  return enLinea
}
