// Pruebas de las reglas y de la cola (src/motor). Uso:  npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clave, construirCola, inicioDelDia } from '../src/motor/cola.ts'
import {
  planificador,
  reconstruir,
  responder,
  type RepasoLocal,
  type Resultado,
  type TarjetaLocal,
  type TarjetasPalabra,
} from '../src/motor/reglas.ts'
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

// Responde en orden y devuelve las tarjetas y los repasos generados
function historia(id: number, pasos: [Direccion, Resultado, Date][]) {
  let tarjetas: TarjetasPalabra = {}
  const repasos: RepasoLocal[] = []
  pasos.forEach(([direccion, resultado, fecha], i) => {
    const { cambiadas } = responder(f, tarjetas, id, { direccion, resultado, fecha })
    tarjetas = { ...tarjetas }
    for (const t of cambiadas) tarjetas[t.direccion] = t
    repasos.push({
      id: `r${i}`, palabraId: id, direccion, fechaHora: fecha.toISOString(), resultado, tipo: 'estudio',
      versionAlgoritmo: 'x', dispositivo: 'x', enviado: 0,
    })
  })
  return { tarjetas, repasos }
}

// Dos aciertos seguidos (pasos de aprendizaje 1 min y 10 min) llevan la tarjeta a repaso
const aprender = (dir: Direccion, desde: Date): [Direccion, Resultado, Date][] => [
  [dir, 'acierto', desde],
  [dir, 'acierto', new Date(desde.getTime() + 10 * 60_000)],
]

const mapa = (...ts: (TarjetaLocal | undefined)[]) =>
  new Map(ts.filter((t): t is TarjetaLocal => !!t).map((t) => [clave(t.palabraId, t.direccion), t]))

test('una palabra nueva pasa por aprendiendo y llega a repaso con nivel', () => {
  const uno = historia(1, [['de-es', 'acierto', T0]])
  assert.equal(uno.tarjetas['de-es']!.estado, 'aprendiendo')
  const dos = historia(1, aprender('de-es', T0))
  assert.equal(dos.tarjetas['de-es']!.estado, 'repaso')
  assert.ok(dos.tarjetas['de-es']!.nivel >= 1)
})

test('un fallo en repaso vuelve a aprendiendo', () => {
  const h = historia(1, [...aprender('de-es', T0), ['de-es', 'fallo', en(3)]])
  assert.equal(h.tarjetas['de-es']!.estado, 'aprendiendo')
  assert.equal(h.tarjetas['de-es']!.fsrs.lapses, 1)
})

test('un acierto tras 90 días o más → aprendida', () => {
  const h = historia(1, [...aprender('de-es', T0), ['de-es', 'acierto', en(89)]])
  assert.equal(h.tarjetas['de-es']!.estado, 'repaso')
  const h2 = historia(1, [...aprender('de-es', T0), ['de-es', 'acierto', en(30)], ['de-es', 'acierto', en(120)]])
  assert.equal(h2.tarjetas['de-es']!.estado, 'aprendida')
})

test('acertar la producción tras 21 días retira el reconocimiento', () => {
  const base = [...aprender('de-es', T0), ...aprender('es-de', en(2))]
  const antes = historia(1, [...base, ['es-de', 'acierto', en(20)]])
  assert.equal(antes.tarjetas['de-es']!.estado, 'repaso')
  const despues = historia(1, [...base, ['es-de', 'acierto', en(25)]])
  assert.equal(despues.tarjetas['de-es']!.estado, 'retirada')
})

test('reconstruir desde los repasos da las mismas tarjetas, en cualquier orden de llegada', () => {
  const h = historia(1, [...aprender('de-es', T0), ['de-es', 'fallo', en(4)], ...aprender('es-de', en(6)), ['de-es', 'acierto', en(9)]])
  const r = reconstruir(f, 1, [...h.repasos].reverse())
  for (const dir of ['de-es', 'es-de'] as const) {
    assert.deepEqual(r[dir]!.fsrs, h.tarjetas[dir]!.fsrs)
    assert.equal(r[dir]!.estado, h.tarjetas[dir]!.estado)
  }
})

test('el día cambia a las 4 de la madrugada', () => {
  assert.equal(inicioDelDia(new Date('2026-11-03T01:30:00')).getDate(), 2)
  assert.equal(inicioDelDia(new Date('2026-11-03T05:00:00')).getDate(), 3)
})

function cola(palabras: Palabra[], tarjetas: Map<string, TarjetaLocal>, ahora: Date, nuevasPorDia = 10, repasosHoy: RepasoLocal[] = []) {
  return construirCola({
    palabras, porId: new Map(palabras.map((p) => [p.id, p])), tarjetas, repasosHoy, nuevasPorDia, ahora, f,
  }).map((i) => `${i.palabra.id}${i.direccion === 'de-es' ? '>' : '<'}${i.motivo[0]}`)
}

test('las raíces van antes que sus compuestos', () => {
  const ps = [palabra(1), palabra(2), palabra(3, { raices: [1, 2] }), palabra(4)]
  assert.deepEqual(cola(ps, new Map(), T0), ['1>n', '2>n', '4>n'])
  // La raíz se adelanta aunque esté después en la lista
  const ps2 = [palabra(5, { raices: [6] }), palabra(6)]
  assert.deepEqual(cola(ps2, new Map(), T0), ['6>n'])
  // Con las raíces ya recordadas, el compuesto entra
  const r1 = historia(1, aprender('de-es', en(-3))).tarjetas['de-es']
  const r2 = historia(2, aprender('de-es', en(-3))).tarjetas['de-es']
  assert.ok(cola(ps, mapa(r1, r2), T0).includes('3>n'))
})

test('solo entran nuevas de tramos validados y hasta el límite diario', () => {
  const ps = [palabra(1), palabra(2, { validada: false }), palabra(3), palabra(4)]
  assert.deepEqual(cola(ps, new Map(), T0, 2), ['1>n', '3>n'])
  // Las empezadas hoy cuentan para el límite
  const hoy = historia(1, [['de-es', 'acierto', T0]]).tarjetas['de-es']
  assert.deepEqual(cola(ps, mapa(hoy), en(0, 30), 2).filter((x) => x.endsWith('n')), ['3>n'])
})

test('producción desbloqueada y nunca las dos direcciones el mismo día', () => {
  const ps = [palabra(1), palabra(2, { direcciones: ['de-es'] })]
  // Reconocimiento aprendido ayer: está en repaso y no vuelve a tocar hasta dentro de unos días
  const h1 = historia(1, aprender('de-es', en(-1))).tarjetas['de-es']
  const h2 = historia(2, aprender('de-es', en(-1))).tarjetas['de-es']
  const c = cola(ps, mapa(h1, h2), T0)
  assert.ok(c.includes('1<p'), 'la 1 se estudia en las dos direcciones')
  assert.ok(!c.some((x) => x.startsWith('2<')), 'la 2 solo en reconocimiento')
  // Si hoy ya se repasó el reconocimiento, la producción espera a mañana
  const hoy: RepasoLocal = {
    id: 'x', palabraId: 1, direccion: 'de-es', fechaHora: T0.toISOString(), resultado: 'acierto', tipo: 'estudio',
    versionAlgoritmo: 'x', dispositivo: 'x', enviado: 0,
  }
  assert.ok(!cola(ps, mapa(h1, h2), T0, 10, [hoy]).some((x) => x.startsWith('1')))
})

test('si las dos direcciones tocan el mismo día, solo va la producción', () => {
  const h = historia(1, [...aprender('de-es', T0), ...aprender('es-de', en(2))]).tarjetas
  const c = cola([palabra(1)], mapa(h['de-es'], h['es-de']), en(400))
  assert.deepEqual(c, ['1<r'])
})

// Fase 3: marcar palabras conocidas y su control

function marcarYResponder(id: number, dir: Direccion, pasos: [Resultado, Date, 'marcado' | 'estudio'][]) {
  let tarjetas: TarjetasPalabra = {}
  const repasos: RepasoLocal[] = []
  pasos.forEach(([resultado, fecha, tipo], i) => {
    const repId = `m${id}-${i}`
    const { cambiadas } = responder(f, tarjetas, id, { direccion: dir, resultado, fecha, tipo, id: repId })
    tarjetas = { ...tarjetas }
    for (const t of cambiadas) tarjetas[t.direccion] = t
    repasos.push({
      id: repId, palabraId: id, direccion: dir, fechaHora: fecha.toISOString(), resultado, tipo,
      versionAlgoritmo: 'x', dispositivo: 'x', enviado: 0,
    })
  })
  return { tarjetas, repasos }
}

test('marcar como conocida programa un control entre 7 y 30 días', () => {
  for (let n = 0; n < 50; n++) {
    const { tarjetas } = marcarYResponder(n, 'es-de', [['acierto', T0, 'marcado']])
    const t = tarjetas['es-de']!
    assert.equal(t.estado, 'conocida')
    const dias = (new Date(t.fsrs.due).getTime() - T0.getTime()) / DIA
    assert.ok(dias >= 7 && dias <= 30, `control a ${dias} días`)
  }
})

test('el control acertado → aprendida; fallado → aprendiendo', () => {
  const ok = marcarYResponder(1, 'es-de', [['acierto', T0, 'marcado'], ['acierto', en(20), 'estudio']])
  assert.equal(ok.tarjetas['es-de']!.estado, 'aprendida')
  const ko = marcarYResponder(1, 'es-de', [['acierto', T0, 'marcado'], ['fallo', en(20), 'estudio']])
  assert.equal(ko.tarjetas['es-de']!.estado, 'aprendiendo')
  assert.equal(ko.tarjetas['es-de']!.fsrs.reps, 1, 'el fallo cuenta como primera presentación')
})

test('desmarcar devuelve la palabra a nueva; marcar una palabra en estudio no hace nada', () => {
  const des = marcarYResponder(1, 'de-es', [['acierto', T0, 'marcado'], ['fallo', en(0, 1), 'marcado']])
  assert.equal(des.tarjetas['de-es']!.estado, 'nueva')
  const enEstudio = historia(1, aprender('de-es', T0)).tarjetas
  const { cambiadas } = responder(f, enEstudio, 1, { direccion: 'de-es', resultado: 'acierto', fecha: en(1), tipo: 'marcado', id: 'z' })
  assert.equal(cambiadas.length, 0)
})

test('reconstruir con marcas y controles da lo mismo', () => {
  const h = marcarYResponder(1, 'es-de', [['acierto', T0, 'marcado'], ['fallo', en(15), 'estudio'], ['acierto', en(15, 10), 'estudio']])
  const r = reconstruir(f, 1, [...h.repasos].reverse())
  assert.deepEqual(r['es-de'], h.tarjetas['es-de'])
})

test('en la cola: las marcadas no gastan el cupo, son raíces sabidas y su control aparece al tocar', () => {
  const ps = [palabra(1), palabra(2), palabra(3, { raices: [1] })]
  const marcada = marcarYResponder(1, 'es-de', [['acierto', T0, 'marcado']]).tarjetas['es-de']
  // Hoy: la 1 no vuelve a salir como nueva; la 3 ya puede entrar (su raíz es conocida)
  assert.deepEqual(cola(ps, mapa(marcada), en(0, 5), 2), ['2>n', '3>n'])
  // El día del control, la 1 sale en producción como control
  const dia = Math.ceil((new Date(marcada!.fsrs.due).getTime() - T0.getTime()) / DIA)
  assert.ok(cola(ps, mapa(marcada), en(dia), 2).includes('1<c'))
  // Desmarcada, vuelve a ser nueva
  const desmarcada = marcarYResponder(1, 'es-de', [['acierto', T0, 'marcado'], ['fallo', T0, 'marcado']]).tarjetas['es-de']
  assert.ok(cola(ps, mapa(desmarcada), en(0, 5), 2).includes('1>n'))
})
