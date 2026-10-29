// Texto alemán → palabras de la lista con sus ocurrencias. Traducción fiel de
// scripts/lematizar.py, que es la especificación (sus reglas están allí). Se ejecuta en el
// dispositivo: el texto nunca sale de él; a la nube solo sube la lista de palabras.

/** data/export/formas.json (scripts/construir_formas.py) */
export interface TablaFormas {
  /** [lema, categoría, palabraIds de sus significados], en orden de frecuencia */
  lemas: [string, string, number[]][]
  /** forma → índices de lemas */
  formas: Record<string, number[]>
  /** «verbo partícula» → índices de lemas */
  separables: Record<string, number[]>
}

export interface Lematizado {
  /** índice de lema → ocurrencias */
  ocurrencias: Map<number, number>
  /** palabras del texto */
  total: number
  /** formas que no están en la lista (palabras funcionales, nombres propios…) */
  fuera: Map<string, number>
}

const CLAUSULA = /[.!?;:,()"«»„“”–—\n]+|(?<!\p{L})(?:und|oder|aber|sondern|denn)(?!\p{L})/u
const TOKEN = /[A-Za-zÄÖÜäöüß]+(?:-[A-Za-zÄÖÜäöüß]+)*/g

const mayuscula = (t: string) => t[0] !== t[0].toLowerCase()
const sumar = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1)

function buscar(tabla: Record<string, number[]>, token: string): number | undefined {
  for (const t of mayuscula(token) ? [token, token.toLowerCase()] : [token]) {
    // Object.hasOwn: una forma como «constructor» no debe encontrar el prototipo
    if (Object.hasOwn(tabla, t)) return Math.min(...tabla[t]) // los índices siguen la frecuencia
  }
  return undefined
}

export function lematizar(texto: string, datos: TablaFormas): Lematizado {
  const { formas, separables } = datos
  const ocurrencias = new Map<number, number>()
  const fuera = new Map<string, number>()
  const total = texto.match(TOKEN)?.length ?? 0 // incluye las conjunciones que separan cláusulas
  for (const clausula of texto.split(CLAUSULA)) {
    const tokens = clausula?.match(TOKEN) ?? []
    if (!tokens.length) continue
    // Verbo separable: «Der Zug kommt um acht an» → ankommen
    const usados = new Set<number>()
    if (tokens.length > 1) {
      const ultima = tokens[tokens.length - 1]
      for (let j = tokens.length - 2; j >= 0; j--) {
        // el verbo más cercano a la partícula
        const t = tokens[j]
        let clave = `${t} ${ultima}`
        if (!Object.hasOwn(separables, clave) && mayuscula(t)) clave = `${t.toLowerCase()} ${ultima}`
        if (Object.hasOwn(separables, clave)) {
          sumar(ocurrencias, Math.min(...separables[clave]))
          usados.add(j).add(tokens.length - 1)
          break
        }
      }
    }
    tokens.forEach((t, j) => {
      if (usados.has(j)) return
      const i = buscar(formas, t)
      if (i === undefined) sumar(fuera, t.toLowerCase())
      else sumar(ocurrencias, i)
    })
  }
  return { ocurrencias, total, fuera }
}

/**
 * Pasa de lemas a palabras de la lista: cada lema se enlaza con su primer significado, porque no
 * se sabe qué sentido usa el texto. Devuelve [palabraId, ocurrencias], de más a menos frecuente
 * en el texto.
 */
export function aPalabras(
  l: Lematizado,
  datos: TablaFormas,
  significado: (palabraId: number) => number | undefined,
): [number, number][] {
  const porPalabra = new Map<number, number>()
  for (const [lema, n] of l.ocurrencias) {
    const ids = datos.lemas[lema][2].filter((id) => significado(id) !== undefined)
    if (!ids.length) continue
    const id = ids.reduce((a, b) => (significado(b)! < significado(a)! ? b : a))
    porPalabra.set(id, (porPalabra.get(id) ?? 0) + n)
  }
  return [...porPalabra.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])
}
