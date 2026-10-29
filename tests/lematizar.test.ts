// El lematizador de la app (src/motor/lematizar.ts) debe dar lo mismo que la especificación,
// scripts/lematizar.py, con tests/texto_prueba.txt. Uso:  npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { aPalabras, lematizar, type TablaFormas } from '../src/motor/lematizar.ts'

const datos: TablaFormas = JSON.parse(readFileSync('data/export/formas.json', 'utf8'))
const texto = readFileSync('tests/texto_prueba.txt', 'utf8')

// Salida de: python -I -X utf8 scripts/lematizar.py tests/texto_prueba.txt --detalle
const ESPERADO_LEMAS =
  'haben×4, an×4, in×2, Schwester×2, sein×2, zu×2, Zug×1, endlich×1, um×1, Uhr×1, ankommen×1, regnen×1, aussteigen×1, umsehen×1, seit×1, Jahr×1, mehr×1, sehen×1, Haus×1, Bahnhof×1, groß×1, Erinnerung×1, mitkommen×1, heute×1, Abend×1, fragen×1, Telefon×1, anrufen×1, sofort×1, wissen×1, wo×1, Restaurant×1, liegen×1, gehen×1, zusammen×1, durch×1, Straße×1, erzählen×1, von×1, Kind×1, Arbeit×1, gut×1, Buch×1, lesen×1, anfangen×1, nah×1, Morgen×1, Wetter×1, ändern×1, herauskommen×1, Sonne×1, Frau×1, beschließen×1, früh×1, aufstehen×1, lang×1, Spaziergang×1, Fluss×1, machen×1, schön×1, erwarten×1'

const lista = (s: string) =>
  s
    .split(', ')
    .map((x) => x.split('×'))
    .sort((a, b) => a[0].localeCompare(b[0]))

test('el lematizador coincide con scripts/lematizar.py', () => {
  const r = lematizar(texto, datos)
  assert.equal(r.total, 122)
  assert.equal([...r.ocurrencias.values()].reduce((a, b) => a + b, 0), 71)
  const lemas = [...r.ocurrencias.entries()].map(([i, n]) => `${datos.lemas[i][0]}×${n}`).join(', ')
  assert.deepEqual(lista(lemas), lista(ESPERADO_LEMAS))
  assert.equal(r.fuera.get('sie'), 8)
})

test('cada lema se enlaza con su primer significado', () => {
  const r = lematizar('Ich habe es. Er hat es.', datos)
  const haben = datos.lemas.findIndex(([l, c]) => l === 'haben' && c === 'verbo')
  const ids = datos.lemas[haben][2]
  assert.ok(ids.length > 1)
  // significado_n inventado: el segundo id es el significado 1
  const palabras = aPalabras(r, datos, (id) => (id === ids[1] ? 1 : id === ids[0] ? 2 : undefined))
  assert.deepEqual(palabras, [[ids[1], 2]])
})
