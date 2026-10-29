// Pruebas del informe de progreso (src/motor/informe.ts). Uso:  npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clave } from '../src/motor/cola.ts'
import { calcularInforme, cobertura, estadoPalabra } from '../src/motor/informe.ts'
import { planificador, reconstruir, type RepasoLocal, type TarjetaLocal } from '../src/motor/reglas.ts'
import type { Direccion, Palabra } from '../src/palabras.ts'

const f = planificador(0.9)
const DIA = 86_400_000
const T0 = new Date('2026-11-02T10:00:00')
const en = (dias: number, minutos = 0) => new Date(T0.getTime() + dias * DIA + minutos * 60_000)

function palabra(id: number, extra: Partial<Palabra> = {}): Palabra {
  return {
    id, orden: id, lema: `w${id}`, categoria: 'sustantivo', significado_n: 1, traduccion_es: `t${id}`,
    direcciones: ['de-es', 'es-de'], validada: true, ...extra,
  }
}

type Paso = [Direccion, 'acierto' | 'fallo', Date, RepasoLocal['tipo']?]

// Repasos de varias palabras y las tarjetas que salen de ellos
function datos(historias: Record<number, Paso[]>) {
  const repasos: RepasoLocal[] = []
  const tarjetas = new Map<string, TarjetaLocal>()
  for (const [id, pasos] of Object.entries(historias)) {
    const propios = pasos.map(([direccion, resultado, fecha, tipo], i): RepasoLocal => ({
      id: `${id}-${i}`, palabraId: Number(id), direccion, fechaHora: fecha.toISOString(), resultado,
      tipo: tipo ?? 'estudio', versionAlgoritmo: 'x', dispositivo: 'x', enviado: 0,
    }))
    repasos.push(...propios)
    for (const t of Object.values(reconstruir(f, Number(id), propios))) tarjetas.set(clave(t.palabraId, t.direccion), t)
  }
  return { repasos, tarjetas }
}

const aprender = (dir: Direccion, desde: Date): Paso[] => [
  [dir, 'acierto', desde],
  [dir, 'acierto', new Date(desde.getTime() + 10 * 60_000)],
]

test('estado de la palabra: nueva, aprendiendo, repaso, conocida y aprendida', () => {
  const { tarjetas } = datos({
    2: [['de-es', 'fallo', T0]],
    3: aprender('de-es', T0),
    4: [['es-de', 'acierto', T0, 'marcado']],
    5: [['es-de', 'acierto', T0, 'marcado'], ['es-de', 'acierto', en(10), 'control']],
  })
  const estado = (id: number) => estadoPalabra(palabra(id), tarjetas).estado
  assert.deepEqual([1, 2, 3, 4, 5].map(estado), ['nueva', 'aprendiendo', 'repaso', 'conocida', 'aprendida'])
  assert.ok(estadoPalabra(palabra(3), tarjetas).nivel >= 1)
})

test('solo cuenta como aprendida si lo está la dirección final', () => {
  // Reconocimiento aprendido, producción sin empezar: sigue en repaso
  const { tarjetas } = datos({ 1: [...aprender('de-es', T0), ['de-es', 'acierto', en(30)], ['de-es', 'acierto', en(130)]] })
  assert.equal(tarjetas.get(clave(1, 'de-es'))!.estado, 'aprendida')
  assert.equal(estadoPalabra(palabra(1), tarjetas).estado, 'repaso')
  assert.equal(estadoPalabra(palabra(1, { direcciones: ['de-es'] }), tarjetas).estado, 'aprendida')
})

test('desglose por total, tramos y categorías', () => {
  const palabras = [palabra(1), palabra(2, { categoria: 'verbo' }), palabra(1001, { orden: 1001 })]
  const { tarjetas, repasos } = datos({ 1: aprender('de-es', T0), 1001: [['de-es', 'acierto', T0, 'marcado']] })
  const inf = calcularInforme({ palabras, tarjetas, repasos, nuevasPorDia: 10, ahora: en(1) })
  assert.equal(inf.total.total, 3)
  assert.equal(inf.total.repaso, 1)
  assert.equal(inf.total.conocida, 1)
  assert.equal(inf.total.nueva, 1)
  assert.deepEqual(inf.tramos.map((t) => t.d.total), [2, 1])
  assert.equal(inf.categorias.find((c) => c.nombre === 'verbo')!.d.nueva, 1)
})

test('ritmo: cuenta las empezadas por semana y no las marcadas; proyección con el ajuste al empezar', () => {
  const palabras = Array.from({ length: 100 }, (_, i) => palabra(i + 1))
  const { tarjetas, repasos } = datos({
    1: aprender('de-es', T0),
    2: aprender('de-es', en(1)),
    3: [['de-es', 'acierto', en(1), 'marcado']],
    4: [['de-es', 'acierto', en(1), 'marcado'], ['de-es', 'fallo', en(1, 1), 'marcado']],
  })
  const inf = calcularInforme({ palabras, tarjetas, repasos, nuevasPorDia: 7, ahora: en(2) })
  assert.equal(inf.semanas.at(-1)!.empezadas, 2)
  assert.equal(inf.semanas.at(-1)!.marcadas, 1)
  // Menos de una semana de datos: se proyecta con el ajuste (7 al día)
  assert.deepEqual(inf.ritmo, { porDia: 7, fuente: 'ajuste' })
  const todas = inf.hitos.at(-1)!
  assert.equal(todas.palabras, 100)
  assert.equal(Math.round((todas.fecha!.getTime() - new Date('2026-11-04T04:00:00').getTime()) / DIA), 14) // 97 / 7 (la 4 vuelve a nueva)
})

test('ritmo real a partir de una semana de datos', () => {
  const palabras = Array.from({ length: 1000 }, (_, i) => palabra(i + 1))
  const historias: Record<number, Paso[]> = {}
  for (let i = 0; i < 20; i++) historias[i + 1] = aprender('de-es', en(Math.floor(i / 2))) // 2 al día, 10 días
  const { tarjetas, repasos } = datos(historias)
  const inf = calcularInforme({ palabras, tarjetas, repasos, nuevasPorDia: 15, ahora: en(9) })
  assert.equal(inf.ritmo.fuente, 'real')
  assert.equal(inf.ritmo.porDia, 2)
  assert.equal(inf.hitos.find((h) => h.palabras === 500)!.fecha!.getTime() > en(200).getTime(), true)
})

test('carga: las atrasadas cuentan hoy y los controles van aparte', () => {
  const palabras = [palabra(1), palabra(2), palabra(3)]
  const { tarjetas, repasos } = datos({
    1: aprender('de-es', T0),
    2: [['es-de', 'acierto', T0, 'marcado']],
  })
  const vence = new Date(tarjetas.get(clave(1, 'de-es'))!.fsrs.due)
  const inf = calcularInforme({ palabras, tarjetas, repasos, nuevasPorDia: 10, ahora: new Date(vence.getTime() + 3 * DIA) })
  assert.equal(inf.carga[0].repasos, 1)
  assert.equal(inf.carga.reduce((s, c) => s + c.controles, 0), 1)
})

test('retención: solo repasos de días distintos, por dirección, y controles', () => {
  const palabras = [palabra(1), palabra(2), palabra(3)]
  const base = datos({
    1: [...aprender('de-es', T0), ['de-es', 'acierto', en(3)]],
    2: [...aprender('de-es', T0), ['de-es', 'fallo', en(3)]],
    3: [['es-de', 'acierto', T0, 'marcado'], ['es-de', 'fallo', en(10), 'control']],
  })
  // rPrevista y días desde el anterior, como los guarda la app al responder
  const repasos = base.repasos.map((r) =>
    r.fechaHora === en(3).toISOString() ? { ...r, rPrevista: 0.9, diasDesdeAnterior: 3 } : r,
  )
  const inf = calcularInforme({ palabras, tarjetas: base.tarjetas, repasos, nuevasPorDia: 10, ahora: en(11) })
  const rec = inf.retencion!.find((r) => r.direccion === 'de-es')!
  assert.deepEqual([rec.n, rec.aciertos], [2, 1])
  assert.ok(Math.abs(rec.prevista - 0.9) < 1e-9)
  assert.deepEqual(inf.controles, { n: 1, aciertos: 0 })
})

test('cobertura de un texto: cada aparición cuenta según el estado de su palabra', () => {
  const palabras = [palabra(1), palabra(2), palabra(3)]
  const porId = new Map(palabras.map((w) => [w.id, w]))
  const { tarjetas } = datos({ 1: aprender('de-es', T0), 2: [['es-de', 'acierto', T0, 'marcado']] })
  // 10 palabras en el texto: 5 veces la 1, 2 la 2, 1 la 3, 1 una retirada (99) y 1 fuera de la lista
  const c = cobertura([[1, 5], [2, 2], [3, 1], [99, 1]], porId, tarjetas, 10)
  assert.deepEqual([c.tokens.repaso, c.tokens.conocida, c.tokens.nueva, c.tokens.total, c.fuera], [5, 2, 1, 8, 2])
})
