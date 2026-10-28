"""Construye la tabla forma → lema para lematizar textos (conjuntos de la app).

Lee las palabras exportadas (data/export/palabras.json) y, de Wiktionary (kaikki),
todas sus formas flexionadas: plurales y casos, conjugaciones, comparativos,
participios, infinitivos con zu (anzukommen). También usa las entradas «form-of»
(p. ej. «besseren», forma de «besser»).

Salida: data/export/formas.json
    lemas       [[lema, categoria, [ids de sus significados por orden]], ...]
    formas      {forma: [índice en lemas, ...]}        una sola palabra
    separables  {"kommt an": [índice], ...}             verbo separable partido

No se incluyen las palabras funcionales (FUNCIONALES) aunque coincidan con una forma
(weil ≠ weilen), y sí las contracciones de preposición y artículo (am → an).
Las formas se guardan con su mayúscula; quien lematiza prueba la forma exacta y, si
no está, la versión en minúscula (palabra a principio de oración).

Uso:  python -I -X utf8 scripts/construir_formas.py
"""

import collections
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from construir_lista_maestra import KAIKKI, KAIKKI_POS, es_forma_flexionada  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent
PALABRAS = RAIZ / "data" / "export" / "palabras.json"
SALIDA = RAIZ / "data" / "export" / "formas.json"

# Formas que no son flexiones de uso normal de la palabra
EXCLUIR = {"inflection-template", "class", "auxiliary", "table-tags", "multiword-construction",
           "diminutive", "romanization", "archaic", "dialectal", "obsolete", "rare",
           "alternative", "nonstandard", "regional", "dated", "uncommon", "proscribed",
           "Austrian", "Swiss", "Switzerland", "error-unknown-tag", "misspelling"}
PALABRA = re.compile(r"^[A-Za-zÄÖÜäöüß]+(?:-[A-Za-zÄÖÜäöüß]+)*$")

# Palabras funcionales (fuera de la lista): nunca se lematizan, aunque coincidan con la
# forma de otra palabra (weil ≠ weilen, acht ≠ achten, einen ≠ einen «unir», Es ≠ la nota mi♭)
FUNCIONALES = set("""
der die das des dem den ein eine einer eines einem einen kein keine keiner keines keinem keinen
ich du er sie es wir ihr mich dich sich uns euch mir dir ihm ihnen ihn man
mein meine meiner meines meinem meinen dein deine deiner deines deinem deinen
ihre ihrer ihres ihrem ihren unser unsere unserer unseres unserem unseren
euer eure eurer eures eurem euren seine seiner seines seinem seinen
dieser diese dieses diesem diesen jener jene jenes jenem jenen welcher welche welches welchem welchen
wer wen wem wessen was jemand niemand nichts etwas alle alles allem allen aller jeder jede jedes jedem jeden
und oder aber denn sondern weil dass ob wenn als wie damit sodass obwohl während bevor nachdem
null eins zwei drei vier fünf sechs sieben acht neun zehn elf zwölf zwanzig hundert tausend
""".split())

# Preposición + artículo contraídos (APPRART)
CONTRACCIONES = {"am": "an", "ans": "an", "im": "in", "ins": "in", "zum": "zu", "zur": "zu",
                 "vom": "von", "beim": "bei", "aufs": "auf", "fürs": "für", "durchs": "durch",
                 "ums": "um", "übers": "über", "unters": "unter", "vors": "vor", "hinters": "hinter"}


def main():
    palabras = json.load(open(PALABRAS, encoding="utf-8"))["palabras"]
    ids_de = collections.defaultdict(list)
    for p in sorted(palabras, key=lambda p: p["orden"]):
        ids_de[(p["lema"], p["categoria"])].append(p["id"])
    lemas = list(ids_de)
    indice = {k: i for i, k in enumerate(lemas)}
    palabras_lema = {k[0] for k in lemas}

    formas = collections.defaultdict(set)
    separables = collections.defaultdict(set)
    for k, i in indice.items():
        formas[k[0]].add(i)

    def anadir(texto, i, verbo):
        texto = texto.strip()
        trozos = texto.split()
        if len(trozos) == 1 and PALABRA.match(texto):
            formas[texto].add(i)
        elif verbo and len(trozos) == 2 and all(PALABRA.match(t) for t in trozos):
            separables[texto].add(i)  # «kommt an»

    with open(KAIKKI, encoding="utf-8") as f:
        for linea in f:
            # Filtro rápido: la palabra o el destino de un «form-of» está en la lista
            if not palabras_lema & set(re.findall(r'"word": "([^"]*)"', linea)):
                continue
            e = json.loads(linea)
            cat = KAIKKI_POS.get(e.get("pos"))
            if e.get("lang_code") != "de" or not cat:
                continue
            palabra = e.get("word", "")

            # Entrada de un lema de la lista: todas sus formas
            if (palabra, cat) in indice and not es_forma_flexionada(e):
                i = indice[(palabra, cat)]
                for fo in e.get("forms") or []:
                    tags = set(fo.get("tags") or [])
                    if tags & EXCLUIR:
                        continue
                    texto = fo.get("form", "")
                    if "includes-article" in tags or texto.startswith("am "):
                        texto = texto.split()[-1]  # «der gute» → gute, «am besten» → besten
                    anadir(texto, i, cat == "verbo")

            # Entrada «form-of» que apunta a un lema de la lista (besseren → besser)
            for s in e.get("senses") or []:
                if set(s.get("tags") or []) & EXCLUIR or s.get("alt_of"):
                    continue
                for destino in s.get("form_of") or []:
                    k = (destino.get("word"), cat)
                    if k in indice:
                        anadir(palabra, indice[k], cat == "verbo")

    for contraccion, prep in CONTRACCIONES.items():
        if (prep, "preposición") in indice:
            formas[contraccion] = {indice[(prep, "preposición")]}
    for f in list(formas):
        if f.lower() in FUNCIONALES and f not in ("sein", "Sein"):  # sein: verbo de la lista
            del formas[f]

    salida = {
        "lemas": [[lema, cat, ids_de[(lema, cat)]] for lema, cat in lemas],
        "formas": {f: sorted(v) for f, v in sorted(formas.items())},
        "separables": {f: sorted(v) for f, v in sorted(separables.items())},
    }
    with open(SALIDA, "w", encoding="utf-8") as f:
        json.dump(salida, f, ensure_ascii=False, separators=(",", ":"))

    ambiguas = sum(len(v) > 1 for v in formas.values())
    con_formas = {i for f, v in formas.items() for i in v if f != lemas[i][0]}
    sin_formas = len(lemas) - len(con_formas)
    print(f"Escrito {SALIDA} ({SALIDA.stat().st_size / 1e6:.1f} MB)")
    print(f"    lemas: {len(lemas)} · formas: {len(formas)} ({ambiguas} con varios lemas)"
          f" · separables partidos: {len(separables)}")
    print(f"    lemas sin ninguna forma flexionada: {sin_formas}")


if __name__ == "__main__":
    main()
