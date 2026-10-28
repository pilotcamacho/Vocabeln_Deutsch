// Contenido de data/export/palabras.json (scripts/exportar_palabras.py). Lo copia
// scripts/copiar_datos.mjs a public/datos/ y el service worker lo guarda para usarlo sin conexión.

export type Direccion = 'de-es' | 'es-de'

export interface Palabra {
  id: number
  orden: number
  lema: string
  categoria: string
  significado_n: number
  traduccion_es: string
  articulo?: string
  genero?: string
  plural?: string
  presente_3sg?: string
  preterito?: string
  participio?: string
  auxiliar?: string
  separable?: string
  comparativo?: string
  superlativo?: string
  caso?: string
  ipa?: string
  pista?: string
  tipo_pista?: string
  raices?: number[]
  direcciones: Direccion[]
  validada: boolean
}

export interface Contenido {
  version: string
  generado: string
  palabras: Palabra[]
  retiradas: number[]
  reemplazos: Record<string, number>
}

export async function cargarPalabras(): Promise<Contenido> {
  const respuesta = await fetch('/datos/palabras.json')
  if (!respuesta.ok) throw new Error(`No se pudo cargar la lista de palabras (${respuesta.status})`)
  return respuesta.json()
}
