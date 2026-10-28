// Prueba de permisos del backend (amplify/data/resource.ts) contra el sandbox.
//
// Necesita tres usuarios de prueba ya creados en el grupo de usuarios del sandbox:
// prueba-a, prueba-b (estudiante) y prueba-admin (estudiante + admin), @vocabeln.invalid,
// con la contraseña de la variable CLAVE_PRUEBA.
//
// Uso:  CLAVE_PRUEBA=... node tests/probar_permisos.mjs
import { readFileSync } from 'node:fs'
import { Amplify } from 'aws-amplify'
import { getCurrentUser, signIn, signOut } from 'aws-amplify/auth'
import { generateClient } from 'aws-amplify/data'

Amplify.configure(JSON.parse(readFileSync('amplify_outputs.json', 'utf8')))
const cliente = generateClient()
const clave = process.env.CLAVE_PRUEBA

let fallos = 0
function comprobar(descripcion, condicion) {
  console.log(`${condicion ? 'OK   ' : 'FALLO'} ${descripcion}`)
  if (!condicion) fallos++
}

async function entrar(usuario) {
  await signOut()
  await signIn({ username: `prueba-${usuario}@vocabeln.invalid`, password: clave })
}

const permitido = (r) => !r.errors?.length && r.data != null

// Estudiante A
await entrar('a')
const perfilA = await cliente.models.Perfil.create({ nombre: 'A' })
comprobar('A crea su perfil (valores por defecto)', permitido(perfilA) && perfilA.data.nuevasPorDia === 15)
const repasoA = await cliente.models.Repaso.create({
  palabraId: 1, direccion: 'de_es', fechaHora: new Date().toISOString(), resultado: 'acierto', tipo: 'estudio',
})
comprobar('A crea un repaso', permitido(repasoA))
comprobar('A no puede modificar un repaso',
  !permitido(await cliente.models.Repaso.update({ id: repasoA.data.id, resultado: 'fallo' })))
comprobar('A no puede borrar un repaso', !permitido(await cliente.models.Repaso.delete({ id: repasoA.data.id })))
const { userId, username } = await getCurrentUser()
const porFecha = await cliente.models.Repaso.repasosPorFecha({ owner: `${userId}::${username}` })
comprobar('A consulta sus repasos por fecha', porFecha.data?.some((r) => r.id === repasoA.data.id))
const tarjetaA = await cliente.models.Tarjeta.create({ palabraId: 1, direccion: 'de_es', estado: 'aprendiendo' })
comprobar('A crea y modifica su tarjeta', permitido(tarjetaA) &&
  permitido(await cliente.models.Tarjeta.update({ id: tarjetaA.data.id, estado: 'repaso', nivel: 1 })))
const privadoA = await cliente.models.Conjunto.create({ nombre: 'Texto de A', tipo: 'texto' })
comprobar('A crea un conjunto privado', permitido(privadoA))
comprobar('A no puede hacer público su conjunto',
  !permitido(await cliente.models.Conjunto.update({ id: privadoA.data.id, lectores: ['estudiante'] })))
comprobar('A no puede crear un conjunto ya público',
  !permitido(await cliente.models.Conjunto.create({ nombre: 'X', tipo: 'tema', lectores: ['estudiante'] })))

// Administrador: conjunto público
await entrar('admin')
const publico = await cliente.models.Conjunto.create({ nombre: 'Tema público', tipo: 'tema', lectores: ['estudiante'] })
comprobar('El admin crea un conjunto público', permitido(publico))
const enlace = await cliente.models.ConjuntoPalabra.create({
  conjuntoId: publico.data.id, palabraId: 1, ocurrencias: 3, lectores: ['estudiante'],
})
comprobar('El admin añade una palabra al conjunto público', permitido(enlace))
comprobar('El admin lee los repasos de A', permitido(await cliente.models.Repaso.get({ id: repasoA.data.id })))

// Estudiante B
await entrar('b')
comprobar('B no ve los repasos de A', (await cliente.models.Repaso.list()).data.length === 0)
comprobar('B no lee el perfil de A', !(await cliente.models.Perfil.get({ id: perfilA.data.id })).data)
comprobar('B no modifica la tarjeta de A',
  !permitido(await cliente.models.Tarjeta.update({ id: tarjetaA.data.id, estado: 'aprendida' })))
comprobar('B no lee el conjunto privado de A', !(await cliente.models.Conjunto.get({ id: privadoA.data.id })).data)
comprobar('B lee el conjunto público', permitido(await cliente.models.Conjunto.get({ id: publico.data.id })))
const palabrasPublico = await cliente.models.ConjuntoPalabra.listConjuntoPalabraByConjuntoId({ conjuntoId: publico.data.id })
comprobar('B lee las palabras del conjunto público', palabrasPublico.data?.length === 1)
comprobar('B no modifica el conjunto público',
  !permitido(await cliente.models.Conjunto.update({ id: publico.data.id, nombre: 'Cambiado' })))

// Limpieza (el admin puede borrar los conjuntos; los repasos se quedan en el sandbox)
await entrar('admin')
await cliente.models.ConjuntoPalabra.delete({ id: enlace.data.id })
await cliente.models.Conjunto.delete({ id: publico.data.id })
await cliente.models.Conjunto.delete({ id: privadoA.data.id })
await signOut()

console.log(fallos ? `\n${fallos} comprobaciones fallidas` : '\nTodas las comprobaciones pasan')
process.exit(fallos ? 1 : 0)
