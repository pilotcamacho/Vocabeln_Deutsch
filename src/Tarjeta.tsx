// Una tarjeta de estudio: la pregunta y, tras intentar recordar, la respuesta completa.
// La pista solo se ve después de intentar recordar (CLAUDE.md, «Curación manual»).

import { Fragment, type ReactNode } from 'react'
import type { ItemCola } from './motor/cola'
import type { Direccion, Palabra } from './palabras'

/** Palabra alemana con su artículo, coloreada por género. */
export function Aleman({ p }: { p: Palabra }) {
  return (
    <span className={`aleman ${p.genero ?? ''}`}>
      {p.articulo && <span className="articulo">{p.articulo} </span>}
      {p.lema}
    </span>
  )
}

/** Texto con *cursivas* de las pistas y traducciones. */
export function Marcado({ texto }: { texto: string }) {
  return (
    <>
      {texto.split(/(\*[^*]+\*)/).map((trozo, i) =>
        trozo.startsWith('*') && trozo.endsWith('*') && trozo.length > 2 ? (
          <em key={i}>{trozo.slice(1, -1)}</em>
        ) : (
          <Fragment key={i}>{trozo}</Fragment>
        ),
      )}
    </>
  )
}

function gramatica(p: Palabra): ReactNode[] {
  const g: ReactNode[] = []
  if (p.categoria === 'sustantivo' && p.plural) g.push(<>plural: <em>die {p.plural}</em></>)
  if (p.categoria === 'verbo' && p.participio) {
    g.push(
      <>
        <em>er {p.presente_3sg}</em> · <em>{p.preterito}</em> ·{' '}
        <em>{p.auxiliar === 'sein' ? 'ist' : 'hat'} {p.participio}</em>
      </>,
    )
    if (p.separable) g.push(<>separable: <em>{p.separable}-</em></>)
  }
  if (p.comparativo) g.push(<><em>{p.comparativo}</em> · <em>{p.superlativo}</em></>)
  if (p.caso) g.push(<>rige {p.caso}</>)
  return g
}

const ETIQUETA_PISTA: Record<string, string> = {
  etimología: 'Origen',
  truco: 'Truco',
  uso: 'Uso',
  automática: 'Pista',
}

interface Props {
  palabra: Palabra
  direccion: Direccion
  motivo: ItemCola['motivo']
  mostrada: boolean
}

export function Tarjeta({ palabra: p, direccion, motivo, mostrada }: Props) {
  const reconocer = direccion === 'de-es'
  return (
    <div className="tarjeta-estudio">
      <div className="etiquetas">
        <span>{p.categoria}</span>
        <span>{reconocer ? 'alemán → español' : 'español → alemán'}</span>
        {(motivo === 'nueva' || motivo === 'produccion') && <span className="nueva">nueva</span>}
        {motivo === 'control' && <span className="nueva">control</span>}
      </div>

      <div className="pregunta">
        {reconocer ? (
          <Aleman p={p} />
        ) : (
          <>
            <span className="espanol">
              <Marcado texto={p.traduccion_es} />
            </span>
            {p.categoria === 'sustantivo' && <span className="aviso">con su artículo</span>}
          </>
        )}
      </div>

      {mostrada && (
        <div className="respuesta">
          <div className="principal">
            {reconocer ? <Marcado texto={p.traduccion_es} /> : <Aleman p={p} />}
          </div>
          {p.ipa && <div className="ipa">{p.ipa}</div>}
          {gramatica(p).map((g, i) => (
            <div key={i} className="gramatica">
              {g}
            </div>
          ))}
          {p.pista && (
            <div className="pista">
              <strong>{ETIQUETA_PISTA[p.tipo_pista ?? ''] ?? 'Pista'}:</strong> <Marcado texto={p.pista} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
