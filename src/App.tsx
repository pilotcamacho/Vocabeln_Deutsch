import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react'
import { fetchAuthSession, fetchUserAttributes, getCurrentUser } from 'aws-amplify/auth'
import { abrirBase, guardarMeta, guardarRepaso, idDispositivo, leerMeta, type BaseLocal } from './datos/base'
import { ajustesLocales, cambiarAjustes, traerPerfil, type Ajustes } from './datos/perfil'
import { sincronizar, type Usuario } from './datos/sincronizar'
import { clave, construirCola, inicioDelDia, type ItemCola } from './motor/cola'
import { planificador, responder, VERSION_ALGORITMO, type Resultado, type TarjetaLocal } from './motor/reglas'
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
      const r = responder(f, actuales, id, { direccion: item.direccion, resultado, fecha })
      await guardarRepaso(
        carga.db,
        {
          id: crypto.randomUUID(),
          palabraId: id,
          direccion: item.direccion,
          fechaHora: fecha.toISOString(),
          resultado,
          tipo: 'estudio',
          tiempoMs,
          diasDesdeAnterior: r.diasDesdeAnterior,
          rPrevista: r.rPrevista,
          versionAlgoritmo: VERSION_ALGORITMO,
          dispositivo: carga.dispositivo,
          enviado: 0,
        },
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
    if (!sesion) calcularCola().then(setColaHoy)
  }, [calcularCola, sesion])

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
  sincronizar: () => void
  guardarAjustes: (a: Ajustes) => Promise<void>
  salir: () => void
}

function Inicio(p: PropsInicio) {
  const { palabras } = p.carga.contenido
  const progreso = useMemo(() => {
    let aprendidas = 0
    let enCurso = 0
    for (const w of palabras) {
      const t = p.tarjetas.get(clave(w.id, w.direcciones.includes('es-de') ? 'es-de' : 'de-es'))
      if (t?.estado === 'aprendida') aprendidas++
      else if (t || p.tarjetas.has(clave(w.id, 'de-es'))) enCurso++
    }
    return { aprendidas, enCurso }
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
          <strong>{progreso.enCurso.toLocaleString('es')}</strong> en curso · de{' '}
          {palabras.length.toLocaleString('es')}
        </p>
        <p className="tenue">{validadas.toLocaleString('es')} listas para estudiar (tramos revisados)</p>
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
        <button onClick={p.salir}>Cerrar sesión</button>
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
