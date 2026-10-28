import { useEffect, useState } from 'react'
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react'
import { fetchAuthSession, fetchUserAttributes } from 'aws-amplify/auth'
import { generateClient } from 'aws-amplify/data'
import type { Schema } from '../amplify/data/resource'
import { cargarPalabras, type Contenido } from './palabras'

const cliente = generateClient<Schema>()

type Perfil = Schema['Perfil']['type']

// Fase 1 (docs/diseno_app.md): acceso, perfil del estudiante y lista de palabras cargada.
// El estudio llega en la fase 2.
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
  return <Inicio />
}

function Inicio() {
  const { signOut } = useAuthenticator()
  const [correo, setCorreo] = useState('')
  const [grupos, setGrupos] = useState<string[]>([])
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [contenido, setContenido] = useState<Contenido | null>(null)
  const [error, setError] = useState('')
  const enLinea = useEnLinea()

  useEffect(() => {
    cargarPalabras().then(setContenido).catch((e) => setError(String(e)))
    ;(async () => {
      try {
        const atributos = await fetchUserAttributes()
        setCorreo(atributos.email ?? '')
        const sesion = await fetchAuthSession()
        setGrupos((sesion.tokens?.idToken?.payload['cognito:groups'] as string[]) ?? [])
        setPerfil(await obtenerPerfil(atributos.email ?? ''))
      } catch (e) {
        setError(String(e))
      }
    })()
  }, [])

  const palabras = contenido?.palabras ?? []
  const validadas = palabras.filter((p) => p.validada).length

  return (
    <main className="inicio">
      <header>
        <h1>Vocabeln Deutsch</h1>
        <span className={enLinea ? 'red si' : 'red no'}>{enLinea ? 'En línea' : 'Sin conexión'}</span>
      </header>

      <section className="tarjeta">
        <h2>Hola{perfil?.nombre ? `, ${perfil.nombre}` : ''}</h2>
        <p>{correo}</p>
        <p>
          Rol: <strong>{grupos.includes('admin') ? 'administrador' : 'estudiante'}</strong>
        </p>
        {perfil && (
          <p>
            Palabras nuevas por día: {perfil.nuevasPorDia} · retención objetivo:{' '}
            {Math.round((perfil.retencionObjetivo ?? 0.9) * 100)} %
          </p>
        )}
      </section>

      <section className="tarjeta">
        <h2>Lista de palabras</h2>
        {contenido ? (
          <>
            <p>
              <strong>{palabras.length.toLocaleString('es')}</strong> significados ·{' '}
              <strong>{validadas.toLocaleString('es')}</strong> listos para estudiar
            </p>
            <p className="tenue">
              Versión {contenido.version} del {contenido.generado}
            </p>
          </>
        ) : (
          <p className="tenue">Cargando…</p>
        )}
      </section>

      <p className="tenue">El estudio llega en la fase 2.</p>
      {error && <p className="error">{error}</p>}
      <button onClick={signOut}>Cerrar sesión</button>
    </main>
  )
}

// Devuelve el perfil del estudiante y lo crea la primera vez que entra.
async function obtenerPerfil(correo: string): Promise<Perfil> {
  const { data, errors } = await cliente.models.Perfil.list()
  if (errors?.length) throw new Error(errors.map((e) => e.message).join('; '))
  if (data.length > 0) return data[0]
  const nuevo = await cliente.models.Perfil.create({ nombre: correo.split('@')[0] })
  if (!nuevo.data) throw new Error(nuevo.errors?.map((e) => e.message).join('; ') ?? 'No se pudo crear el perfil')
  return nuevo.data
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
