"""Lematizador de referencia: texto alemán → palabras de la lista con sus ocurrencias.

Es la especificación de lo que hará la Lambda que crea conjuntos a partir de un texto
(docs/diseno_app.md, «Crear un conjunto a partir de un texto»). Usa data/export/formas.json.

Reglas:
1. El texto se parte en oraciones y cláusulas por la puntuación (. ! ? ; : , y comillas)
   y por las conjunciones coordinantes (und, oder, aber, sondern, denn).
2. Cada palabra se busca tal cual; si no está y empieza por mayúscula, en minúscula
   (principio de oración).
3. Verbo separable: si la última palabra de la cláusula es una partícula y «verbo
   partícula» está en la tabla (kommt … an), cuenta como el verbo compuesto y la
   partícula no cuenta aparte. Si hay varios verbos posibles, el más cercano a la partícula.
4. Si una forma corresponde a varios lemas (laut: adjetivo, preposición, lauten), se
   elige el más frecuente (menor orden).

Uso:  python -I -X utf8 scripts/lematizar.py texto.txt [--detalle]
"""

import collections
import json
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
FORMAS = RAIZ / "data" / "export" / "formas.json"

CLAUSULA = re.compile(r"[.!?;:,()\"«»„“”–—\n]+|\b(?:und|oder|aber|sondern|denn)\b")
TOKEN = re.compile(r"[A-Za-zÄÖÜäöüß]+(?:-[A-Za-zÄÖÜäöüß]+)*")


def cargar(ruta=FORMAS):
    return json.load(open(ruta, encoding="utf-8"))


def buscar(tabla, token):
    for t in (token, token.lower()) if token[0].isupper() else (token,):
        if t in tabla:
            return min(tabla[t])  # los índices de lemas siguen el orden de frecuencia
    return None


def lematizar(texto, datos):
    """Devuelve (ocurrencias por índice de lema, nº de palabras, palabras fuera de la lista)."""
    formas, separables = datos["formas"], datos["separables"]
    ocurrencias = collections.Counter()
    fuera = collections.Counter()
    total = len(TOKEN.findall(texto))  # incluye las conjunciones que separan cláusulas
    for clausula in CLAUSULA.split(texto):
        tokens = TOKEN.findall(clausula)
        if not tokens:
            continue
        # Verbo separable: «Der Zug kommt um acht an» → ankommen
        usados = set()
        if len(tokens) > 1:
            ultima = tokens[-1]
            for j in range(len(tokens) - 2, -1, -1):  # el verbo más cercano a la partícula
                t = tokens[j]
                clave = f"{t} {ultima}"
                if clave not in separables and t[0].isupper():
                    clave = f"{t.lower()} {ultima}"
                if clave in separables:
                    ocurrencias[min(separables[clave])] += 1
                    usados.update({j, len(tokens) - 1})
                    break
        for j, t in enumerate(tokens):
            if j in usados:
                continue
            i = buscar(formas, t)
            if i is None:
                fuera[t.lower()] += 1
            else:
                ocurrencias[i] += 1
    return ocurrencias, total, fuera


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    datos = cargar()
    texto = Path(sys.argv[1]).read_text(encoding="utf-8")
    ocurrencias, total, fuera = lematizar(texto, datos)
    en_lista = sum(ocurrencias.values())
    print(f"Palabras del texto: {total}")
    print(f"    en la lista: {en_lista} ({en_lista / total:.0%}) · lemas distintos: {len(ocurrencias)}")
    print(f"    fuera de la lista: {total - en_lista} ({(total - en_lista) / total:.0%})")
    if "--detalle" in sys.argv:
        lemas = datos["lemas"]
        print("Lemas:", ", ".join(f"{lemas[i][0]}×{n}" for i, n in ocurrencias.most_common()))
        print("Fuera:", ", ".join(f"{w}×{n}" for w, n in fuera.most_common()))


if __name__ == "__main__":
    main()
