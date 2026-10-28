"""Construye la lista maestra de vocabulario alemán.

Fuentes (en data/raw/):
  - DeReWo 2014 (IDS Mannheim): frecuencia por lema y categoría, alemán escrito.
  - SUBTLEX-DE (Brysbaert et al., 2011), versión con lemas: frecuencia en subtítulos.
  - Wiktionary inglés vía kaikki.org: género, plural, formas, etimología, compuestos.
  - WikDict de-es: traducciones al español por significado.

Salida: data/lista_maestra.csv (UTF-8 con BOM, abre bien en Excel).

Uso:  python -I -X utf8 scripts/construir_lista_maestra.py [--total 16000]
"""

import argparse
import collections
import csv
import json
import math
import re
import sqlite3
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
RAW = RAIZ / "data" / "raw"
DEREWO = RAW / "derewo" / "DeReKo-2014-II-MainArchive-STT.100000.freq"
DEREWO_TOKENS = 7.0e9  # tamaño aproximado del corpus según su readme
SUBTLEX = RAW / "subtlex" / "SUBTLEXDE_LemmasJV.csv"
KAIKKI = RAW / "kaikki" / "kaikki.org-dictionary-German.jsonl"
WIKDICT = RAW / "wikdict" / "de-es.sqlite3"
WIKDICT_INVERSO = RAW / "wikdict" / "es-de.sqlite3"
SALIDA = RAIZ / "data" / "lista_maestra.csv"

# --- Categorías -----------------------------------------------------------

STTS = {
    "NN": "sustantivo",
    **{t: "verbo" for t in ("VVFIN", "VVINF", "VVPP", "VVIZU", "VVIMP",
                            "VAFIN", "VAINF", "VAPP", "VAIMP",
                            "VMFIN", "VMINF", "VMPP")},
    "ADJA": "adjetivo", "ADJD": "adjetivo",
    "ADV": "adverbio", "PROAV": "adverbio", "PAV": "adverbio", "PWAV": "adverbio",
    "APPR": "preposición", "APPO": "preposición", "APZR": "preposición",
}
KAIKKI_POS = {"noun": "sustantivo", "verb": "verbo", "adj": "adjetivo",
              "adv": "adverbio", "prep": "preposición", "postp": "preposición"}
WIKDICT_POS = {
    "Substantiv": "sustantivo", "Verb": "verbo", "Adjektiv": "adjetivo",
    "Präposition": "preposición", "Postposition": "preposición",
    **{p: "adverbio" for p in ("Adverb", "Lokaladverb", "Temporaladverb", "Modaladverb",
                               "Kausaladverb", "Pronominaladverb", "Interrogativadverb",
                               "Konjunktionaladverb")},
}

# Penalización (en puntos Zipf) para el 2.º, 3.º… significado de una palabra:
# los significados secundarios se estudian después que los principales.
PENALIZACION_SIGNIFICADO = 0.7
MAX_SIGNIFICADOS = 3

# --- Etimología -------------------------------------------------------------

IDIOMAS = {
    "gmh": "alto alemán medio", "goh": "alto alemán antiguo", "gml": "bajo alemán medio",
    "nds": "bajo alemán", "nds-de": "bajo alemán", "osx": "sajón antiguo",
    "gem-pro": "protogermánico", "gmw-pro": "protogermánico occidental",
    "ine-pro": "protoindoeuropeo",
    "la": "latín", "la-lat": "latín tardío", "la-med": "latín medieval",
    "la-new": "latín moderno", "la-vul": "latín vulgar", "LL.": "latín tardío", "ML.": "latín medieval",
    "grc": "griego antiguo", "el": "griego", "fr": "francés", "frm": "francés medio",
    "fro": "francés antiguo", "it": "italiano", "es": "español", "pt": "portugués",
    "en": "inglés", "nl": "neerlandés", "dum": "neerlandés medio", "da": "danés",
    "sv": "sueco", "ar": "árabe", "tr": "turco", "ota": "turco otomano", "fa": "persa",
    "cs": "checo", "pl": "polaco", "ru": "ruso", "yi": "yidis", "he": "hebreo",
    "hbo": "hebreo antiguo", "sla-pro": "protoeslavo", "cel-pro": "protocelta",
}
LATINAS = {"la", "la-lat", "la-med", "la-new", "la-vul", "LL.", "ML.", "grc", "fr",
           "frm", "fro", "it", "es", "pt"}
PLANT_ORIGEN = {"inh", "inh+", "der", "der+", "bor", "bor+", "lbor", "slbor", "ubor",
                "lbor+", "calque", "cal", "clq", "sl"}
PLANT_PARTES = {"com", "compound", "af", "affix", "prefix", "pre", "suffix", "suf",
                "confix", "con", "univerbation", "univ"}

# Afijos frecuentes con su función, para las pistas.
PREFIJOS = {
    "ab": "separación, quitar", "an": "hacia, contacto, inicio", "auf": "hacia arriba, abrir",
    "aus": "hacia fuera", "be": "convierte en transitivo", "bei": "junto a",
    "durch": "a través", "ein": "hacia dentro", "ent": "des-, quitar", "emp": "des-, quitar",
    "er": "lograr, completar", "ge": "colectivo o resultado", "her": "hacia aquí",
    "hin": "hacia allá", "miss": "mal-, error", "mit": "con", "nach": "después, imitar",
    "über": "sobre, demasiado", "um": "alrededor, cambio", "un": "in-, des- (negación)",
    "unter": "debajo", "ver": "cambio, error o final", "vor": "delante, antes",
    "weg": "fuera, lejos", "zer": "romper en pedazos", "zu": "hacia, cerrar",
    "zurück": "atrás, de vuelta", "ur": "original, primitivo", "erz": "archi-",
    "wieder": "de nuevo", "wider": "contra", "fort": "adelante, fuera", "los": "soltar, empezar",
    "dar": "presentar, ofrecer", "zusammen": "juntos", "heraus": "hacia fuera",
    "herein": "hacia dentro", "hinaus": "hacia fuera", "voran": "adelante", "vorbei": "pasando",
}
SUFIJOS = {
    "heit": "cualidad (-dad), femenino", "keit": "cualidad (-dad), femenino",
    "igkeit": "cualidad (-dad), femenino", "ung": "acción o resultado (-ción), femenino",
    "schaft": "conjunto o estado, femenino", "er": "agente o persona, masculino",
    "in": "forma femenina", "chen": "diminutivo, neutro", "lein": "diminutivo, neutro",
    "lich": "-al, -ble", "ig": "-oso, que tiene", "isch": "-ico", "bar": "-ble (se puede)",
    "los": "sin", "voll": "lleno de", "sam": "-oso, inclinado a", "haft": "semejante a",
    "tum": "estado o conjunto, neutro", "nis": "resultado o estado", "ling": "persona, masculino",
    "ei": "lugar o actividad, femenino", "ieren": "verbo (-ar)", "weise": "de manera…",
    "mäßig": "según, propio de", "wert": "digno de", "würdig": "digno de", "frei": "sin",
    "reich": "rico en", "arm": "pobre en", "mal": "veces", "ern": "verbo", "eln": "verbo",
    "ation": "-ación, femenino", "ität": "-idad, femenino", "ismus": "-ismo, masculino",
    "ist": "-ista, masculino", "ie": "-ía, femenino", "ik": "-ica, femenino",
    "ur": "-ura, femenino", "ent": "-ente, masculino", "ant": "-ante, masculino",
    "end": "participio presente (-ante)", "e": "sustantivo",
}
FUGEN = {"s", "es", "n", "en", "e", "er", "ens"}

# Caso que rige cada preposición (Wiktionary no siempre lo indica en la glosa).
_ACU = "acusativo"
_DAT = "dativo"
_GEN = "genitivo"
_WECHSEL = "acusativo/dativo"
CASO_PREPOSICION = {
    **{p: _ACU for p in ("durch", "für", "gegen", "ohne", "um", "bis", "entlang", "wider", "per", "pro")},
    **{p: _DAT for p in ("aus", "bei", "mit", "nach", "seit", "von", "zu", "ab", "gegenüber",
                         "außer", "gemäß", "entgegen", "samt", "nebst", "zufolge", "binnen", "dank")},
    **{p: _WECHSEL for p in ("an", "auf", "hinter", "in", "neben", "über", "unter", "vor", "zwischen")},
    **{p: _GEN for p in ("wegen", "trotz", "während", "statt", "anstatt", "innerhalb", "außerhalb",
                         "aufgrund", "infolge", "mithilfe", "anhand", "angesichts", "bezüglich",
                         "hinsichtlich", "laut", "oberhalb", "unterhalb", "seitens", "jenseits",
                         "diesseits", "inmitten", "abseits", "unweit", "zugunsten", "mittels",
                         "anlässlich", "zwecks", "einschließlich", "ausschließlich", "kraft",
                         "beiderseits", "zuzüglich", "abzüglich", "ungeachtet", "unbeschadet")},
}

# Equivalencias de terminaciones alemán → español, para detectar parecidos.
TERMINACIONES_ES = [("ation", "acion"), ("tion", "cion"), ("ität", "idad"), ("ismus", "ismo"),
                    ("ieren", "ar"), ("ie", "ia"), ("ik", "ica"), ("ist", "ista"),
                    ("ell", "al"), ("iv", "ivo"), ("ant", "ante"), ("ent", "ente"),
                    ("ur", "ura"), ("ös", "oso"), ("är", "ario"), ("isch", "ico")]
# Cambios de sonido regulares alemán → inglés (segunda mutación consonántica y otros).
CAMBIOS_EN = [("tz", "t"), ("ss", "t"), ("ß", "t"), ("z", "t"), ("pf", "p"), ("ch", "k"),
              ("au", "ou"), ("ei", "i"), ("ie", "ee"), ("th", "t")]


def sin_acentos(s):
    s = s.lower().replace("ß", "ss")
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def zipf(por_millon):
    return math.log10(por_millon) + 3 if por_millon > 0 else None


# --- 1. Frecuencias -------------------------------------------------------------

def cargar_derewo():
    """Devuelve {(lema, categoría): frec} y {lema_minúsculas: frec total, todas las categorías}."""
    frec = collections.Counter()
    total = collections.Counter()
    with open(DEREWO, encoding="utf-8", errors="replace") as f:
        for linea in f:
            partes = linea.rstrip("\n").split("\t")
            if len(partes) != 4:
                continue
            _, lema, tag, n = partes
            if lema in ("<unknown>", "") or not any(c.isalpha() for c in lema):
                continue
            lema = lema.split("|")[0]
            n = float(n)
            total[lema.lower()] += n
            cat = STTS.get(tag)
            if not cat:
                continue
            if cat == "sustantivo":
                lema = lema[:1].upper() + lema[1:]
            elif lema[:1].isupper() and not lema.isupper():
                lema = lema.lower()
            frec[(lema, cat)] += n
    return frec, total


def cargar_subtlex():
    frec = {}
    with open(SUBTLEX, encoding="utf-8") as f:
        for fila in csv.DictReader(f):
            clave = fila["Lemma"].lower()
            if clave not in frec:
                frec[clave] = float(fila["LemmaFreq"] or 0)
    return frec


def combinar_frecuencias(derewo, derewo_total, subtlex):
    """Zipf combinado: media de DeReWo (escrito) y SUBTLEX (hablado).
    SUBTLEX no tiene categoría: se reparte según la proporción de cada categoría en DeReWo."""
    res = {}
    for (lema, cat), n in derewo.items():
        z_d = zipf(n / DEREWO_TOKENS * 1e6)
        clave = lema.lower()
        z_s = None
        if clave in subtlex and derewo_total[clave] > 0:
            z_s = zipf(subtlex[clave] * n / derewo_total[clave])
        if z_d is not None and z_s is not None:
            z = (z_d + z_s) / 2
        else:
            z = (z_d or z_s) - 0.3
        res[(lema, cat)] = {"zipf": z, "zipf_derewo": z_d, "zipf_subtlex": z_s}
    return res


# --- 2. Wiktionary (kaikki) ---------------------------------------------------------

FLEXION = {"plural", "genitive", "dative", "accusative", "nominative", "past", "present",
           "participle", "first-person", "second-person", "third-person", "imperative",
           "subjunctive", "comparative", "superlative", "inflection-of", "infinitive", "gerund"}


def es_forma_flexionada(entrada):
    """Formas flexionadas, grafías alternativas u obsoletas (kraß → krass): no son lemas.
    Las derivadas que Wiktionary también marca «form-of» (Lehrer ← lehren) sí lo son."""
    def descartable(s):
        tags = set(s.get("tags") or [])
        if s.get("alt_of") or {"alt-of", "misspelling", "obsolete"} & tags:
            return True
        return bool(s.get("form_of") or "form-of" in tags) and bool(tags & FLEXION)
    return all(descartable(s) for s in entrada.get("senses") or [])


def normalizar_ortografia(derewo, derewo_total, subtlex, kaikki):
    """El etiquetador de DeReWo usa a veces la ortografía anterior a 1996 (Schuß, daß).
    Si la grafía con «ss» existe en Wiktionary y la de «ß» no, se suman en la nueva."""
    validas = {w.lower() for w, _ in kaikki}
    nuevo = collections.Counter()
    for (lema, cat), n in derewo.items():
        alt = lema.replace("ß", "ss")
        if "ß" in lema and (lema, cat) not in kaikki and (alt, cat) in kaikki:
            lema = alt
        nuevo[(lema, cat)] += n
    for tabla in (derewo_total, subtlex):
        for clave in [k for k in tabla if "ß" in k]:
            alt = clave.replace("ß", "ss")
            if alt in validas:
                tabla[alt] = tabla.get(alt, 0) + tabla.pop(clave)
    return nuevo


def cargar_kaikki(palabras):
    datos = collections.defaultdict(list)
    with open(KAIKKI, encoding="utf-8") as f:
        for linea in f:
            # Filtro rápido antes de parsear el JSON completo ("word" también aparece
            # en objetos anidados, así que basta con que alguna coincidencia esté en el conjunto).
            if not any(w in palabras for w in re.findall(r'"word": "([^"]*)"', linea)):
                continue
            e = json.loads(linea)
            cat = KAIKKI_POS.get(e.get("pos"))
            if cat and e.get("word") in palabras and not es_forma_flexionada(e):
                datos[(e["word"], cat)].append(e)
    # La entrada principal es la de la primera etimología (p. ej. Tag «día» antes que Tag «etiqueta»).
    for entradas in datos.values():
        entradas.sort(key=lambda e: e.get("etymology_number") or 0)
    return datos


def formas(entrada, *etiquetas, excluir=("archaic", "dialectal", "obsolete", "rare",
                                         "alternative", "nonstandard", "regional", "colloquial",
                                         "informal", "dated", "uncommon", "proscribed",
                                         "Austrian", "Swiss", "Switzerland", "error-unknown-tag")):
    for fo in entrada.get("forms") or []:
        if fo.get("source") in ("declension", "conjugation", "inflection"):
            continue
        t = set(fo.get("tags") or [])
        if set(etiquetas) <= t and not t & set(excluir):
            yield fo["form"]


def primero(it, defecto=""):
    return next(iter(it), defecto)


def expansion_cabecera(e):
    return " ".join(h.get("expansion", "") for h in e.get("head_templates") or [])


def datos_gramaticales(cat, entradas):
    e = entradas[0]
    g = {}
    exp = expansion_cabecera(e)
    if cat == "sustantivo":
        cab = exp.split("(")[0].split()
        generos = [t for t in cab[1:] if t in ("m", "f", "n", "pl", "p")]
        mapa = {"m": "der", "f": "die", "n": "das", "pl": "die (pl.)", "p": "die (pl.)"}
        g["articulo"] = "/".join(dict.fromkeys(mapa[x] for x in generos))
        g["genero"] = "/".join(dict.fromkeys(
            {"m": "masculino", "f": "femenino", "n": "neutro", "pl": "solo plural",
             "p": "solo plural"}[x] for x in generos))
        g["plural"] = "—" if "no plural" in exp else primero(formas(e, "plural"))
    elif cat == "verbo":
        g["presente_3sg"] = primero(formas(e, "present", "singular", "third-person"))
        g["preterito"] = primero(fo for fo in formas(e, "past") if fo)
        g["participio"] = primero(formas(e, "participle", "past"))
        g["auxiliar"] = "/".join(dict.fromkeys(formas(e, "auxiliary")))
        tipo = re.search(r"\b(strong|weak|irregular|mixed)\b", exp)
        g["tipo_verbo"] = {"strong": "fuerte", "weak": "débil", "irregular": "irregular",
                           "mixed": "mixto"}.get(tipo.group(1), "") if tipo else ""
        arg = ((e.get("head_templates") or [{}])[0].get("args") or {}).get("1", "")
        m = re.match(r"^([a-zäöü]+)\.", arg)
        g["separable"] = m.group(1) if m else ""
    elif cat == "adjetivo":
        g["comparativo"] = primero(formas(e, "comparative"))
        g["superlativo"] = primero(formas(e, "superlative"))
    elif cat == "preposición":
        if e["word"] in CASO_PREPOSICION:
            g["caso"] = CASO_PREPOSICION[e["word"]]
        else:
            texto = " ".join(" ".join(s.get("glosses") or []) for s in (e.get("senses") or [])[:3])
            g["caso"] = "/".join(c for c, en in (("acusativo", "accusative"), ("dativo", "dative"),
                                                ("genitivo", "genitive")) if en in texto)
    g["ipa"] = primero(s["ipa"] for s in (e.get("sounds") or []) if s.get("ipa"))
    # Solo la entrada principal: otras etimologías (homónimos) confundirían los parecidos.
    g["glosa_en"] = "; ".join(dict.fromkeys(
        re.sub(r"\s*\(.*?\)|\[.*?\]", "", (s.get("glosses") or [""])[0]).strip()
        for s in (e.get("senses") or [])[:3] if s.get("glosses")))[:120]
    return g


def etimologia(entradas):
    origen, partes, cognados_en = [], [], []
    for e in entradas:
        for t in e.get("etymology_templates") or []:
            nombre, a = t.get("name"), t.get("args") or {}
            if nombre in PLANT_ORIGEN and a.get("2") and a.get("3"):
                origen.append((a["2"], a["3"]))
            elif nombre in ("ety", "etymon") and ":" in a.get("3", "").split("<")[0]:
                idioma, termino = a["3"].split("<")[0].split(":", 1)
                origen.append((idioma, termino))
            elif nombre in PLANT_PARTES and not partes and a.get("1") == "de":
                # Solo descomposiciones en alemán actual, no de etapas antiguas (jetzt ← ie + zuo).
                nums = [a[k] for k in sorted((k for k in a if k.isdigit() and k != "1"), key=int)
                        if a[k].strip()]
                if nombre in ("prefix", "pre") and nums:
                    nums[0] = nums[0].rstrip("-") + "-"
                if nombre in ("suffix", "suf") and len(nums) > 1:
                    nums[-1] = "-" + nums[-1].lstrip("-")
                partes = [re.sub(r"<.*?>", "", p) for p in nums]
            elif nombre == "cog" and a.get("1") == "en" and a.get("2"):
                cognados_en.append(a["2"])
        if origen or partes:
            break
    vistos, cadena = set(), []
    for idioma, termino in origen:
        if (idioma, termino) not in vistos and idioma in IDIOMAS:
            vistos.add((idioma, termino))
            cadena.append((idioma, termino))
    return cadena, partes, cognados_en


# --- 3. Traducciones al español (WikDict) --------------------------------------------

def cargar_wikdict():
    """{(lema, categoría): [(traducciones, sentido_de), …]} agrupado por significado.
    Dos sentidos alemanes son el mismo «significado» si la primera traducción de uno ya está
    entre las del otro: solo se separan cuando el español necesita palabras distintas."""
    con = sqlite3.connect(WIKDICT)
    filas = con.execute("SELECT lexentry, sense_num, sense, trans_list FROM translation "
                        "WHERE lexentry IS NOT NULL ORDER BY lexentry, sense_num")
    res = collections.defaultdict(list)
    for lexentry, _, sentido, trans in filas:
        partes = lexentry.split("/", 1)[-1].split("__")
        if len(partes) < 2:
            continue
        cat = WIKDICT_POS.get(partes[1])
        if not cat or not trans:
            continue
        lema = partes[0].replace("_", " ")
        trads = [t.strip() for t in trans.split("|") if t.strip()]
        grupos = res[(lema, cat)]
        for g in grupos:
            if trads[0] in g["trads"]:
                g["trads"] += [t for t in trads if t not in g["trads"]]
                break
        else:
            grupos.append({"trads": trads, "sentido": (sentido or "").strip()})
    return res


def cargar_wikdict_inverso():
    """Traducciones español → alemán, invertidas. Se usan solo si falta la traducción directa."""
    con = sqlite3.connect(WIKDICT_INVERSO)
    res = collections.defaultdict(list)
    for es, trans, puntos in con.execute("SELECT written_rep, trans_list, max_score "
                                         "FROM simple_translation WHERE max_score >= 50"):
        for de in trans.split("|"):
            res[de.strip()].append((puntos, es))
    return {de: [es for _, es in sorted(v, reverse=True)[:3]] for de, v in res.items()}


# --- 4. Parecidos y pistas ------------------------------------------------------------

def parecido(a, b):
    return SequenceMatcher(None, a, b).ratio()


def parecido_espanol(lema, cat, trads):
    base = sin_acentos(lema)
    for de, es in TERMINACIONES_ES:
        de = sin_acentos(de)
        if base.endswith(de):
            base = base[: -len(de)] + es
            break
    else:
        if cat == "verbo":
            base = re.sub(r"e?n$", "", base)
    mejor = ("", 0.0)
    for t in trads[:4]:
        t0 = sin_acentos(t.split()[0]) if t else ""
        if cat == "verbo":
            t0 = re.sub(r"(ar|er|ir)(se)?$", "", t0)
            b0 = re.sub(r"ar$", "", base)
        else:
            b0 = base
        if len(t0) >= 3 and len(b0) >= 3:
            r = parecido(b0, t0)
            if r > mejor[1]:
                mejor = (t, r)
    return mejor[0] if mejor[1] >= 0.75 else ""


def parecido_ingles(lema, cognados, glosa_en):
    palabras_glosa = {w for w in re.findall(r"[a-z]+", glosa_en.lower()) if w != "to"}
    for c in cognados:
        if c.lower() in palabras_glosa:
            return c
    base = sin_acentos(lema)
    variantes = {base, re.sub(r"e?n$", "", base)}
    for de, en in CAMBIOS_EN:
        variantes |= {v.replace(de, en) for v in variantes}
    for w in palabras_glosa:
        if len(w) >= 3 and max(parecido(v, w) for v in variantes) >= 0.8:
            return w
    return ""


def describir_origen(cadena):
    """Resumen corto: el paso más útil para un hispanohablante (latín/romance) o el más reciente."""
    latina = next(((i, t) for i, t in cadena if i in LATINAS), None)
    if latina:
        return f"del {IDIOMAS[latina[0]]} «{latina[1]}»", True
    pasos = [f"{IDIOMAS[i]} «{t}»" for i, t in cadena[:2]]
    return " ← ".join(pasos), False


# --- 5. Programa principal --------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--total", type=int, default=16000, help="número de palabras (significados)")
    args = ap.parse_args()

    print("1/5 Frecuencias…")
    derewo, derewo_total = cargar_derewo()
    subtlex = cargar_subtlex()
    print(f"    {len(derewo)} pares (lema, categoría) en DeReWo")

    print("2/5 Wiktionary…")
    palabras = {lema for lema, _ in derewo}
    kaikki = cargar_kaikki(palabras | {p.replace("ß", "ss") for p in palabras if "ß" in p})
    derewo = normalizar_ortografia(derewo, derewo_total, subtlex, kaikki)
    frec = combinar_frecuencias(derewo, derewo_total, subtlex)
    candidatos = {k: v for k, v in frec.items() if k in kaikki and len(k[0]) >= 2}
    print(f"    {len(candidatos)} validados en Wiktionary")

    print("3/5 Traducciones…")
    wikdict = cargar_wikdict()
    inverso = cargar_wikdict_inverso()

    print("4/5 Gramática, etimología y raíces…")
    info = {}
    for (lema, cat), f in candidatos.items():
        g = datos_gramaticales(cat, kaikki[(lema, cat)])
        cadena, partes, cognados = etimologia(kaikki[(lema, cat)])
        if cat == "verbo" and g.get("separable") and not partes:
            partes = [g["separable"] + "-", lema[len(g["separable"]):]]
        grupos = wikdict.get((lema, cat), [])
        g["fuente_traduccion"] = "WikDict"
        if not grupos and inverso.get(lema):
            grupos = [{"trads": inverso[lema], "sentido": ""}]
            g["fuente_traduccion"] = "WikDict (inverso)"
        info[(lema, cat)] = {**f, **g, "cadena": cadena, "partes": partes,
                             "cognados_en": cognados, "grupos": grupos}

    por_forma = collections.defaultdict(list)
    for (lema, cat), d in info.items():
        por_forma[lema.lower()].append(((lema, cat), d["zipf"]))

    def buscar_lema(parte):
        """Encuentra el lema candidato más frecuente que corresponde a una parte
        (Wohn → wohnen; las partes cortas no se amplían para no confundir ein → einen)."""
        p = parte.strip("-").lower()
        for clave in (p, p + "en", p + "n") if len(p) >= 4 else (p,):
            if clave in por_forma:
                return max(por_forma[clave], key=lambda x: x[1])[0]
        return None

    sustantivos = {lema for (lema, cat) in info if cat == "sustantivo"}
    derivaciones = [("ung", "verbo"), ("heit", "adjetivo"), ("keit", "adjetivo"),
                    ("schaft", "sustantivo"), ("er", "verbo")]

    def partir_compuesto(lema):
        """Heurística para sustantivos sin descomposición en Wiktionary.
        Primero derivaciones (Unterscheidung → unterscheiden + -ung), después compuestos."""
        for suf, cat_base in derivaciones:
            if lema.endswith(suf) and len(lema) - len(suf) >= 3:
                base = lema[: -len(suf)]
                base = base.capitalize() if cat_base == "sustantivo" else base.lower()
                for cand in ((base + "en", base + "n") if cat_base == "verbo" else (base,)):
                    if (cand, cat_base) in info:
                        return [cand, "-" + suf], "heurística"
        for i in range(3, len(lema) - 2):
            izq, der = lema[:i], lema[i:].capitalize()
            if der not in sustantivos or len(der) < 3:
                continue
            for fuge in [""] + sorted(FUGEN, key=len, reverse=True):
                base = izq[: -len(fuge)] if fuge and izq.endswith(fuge) else (izq if not fuge else None)
                ref = buscar_lema(base) if base and len(base) >= 3 else None
                # Una preposición o adverbio a la izquierda suele ser un verbo con prefijo
                # sustantivado (Vorhersage ← vorhersagen), no un compuesto.
                if ref and ref[1] not in ("preposición", "adverbio"):
                    return [base, der], "heurística"
        return [], ""

    for clave, d in info.items():
        lema, cat = clave
        origen_partes = "Wiktionary" if d["partes"] else ""
        if not d["partes"] and cat == "sustantivo" and len(lema) >= 7:
            d["partes"], origen_partes = partir_compuesto(lema)
        raices, afijos = [], []
        ultimo = len(d["partes"]) - 1
        for i, p in enumerate(d["partes"]):
            limpio = p.strip("-").lower()
            if not limpio or (0 < i < ultimo and limpio in FUGEN):
                continue
            if p.startswith("-") or (i == ultimo and i > 0 and limpio in SUFIJOS):
                if limpio in SUFIJOS:
                    afijos.append("-" + limpio)
                continue
            ref = buscar_lema(limpio)
            if ref and ref != clave:
                raices.append(ref)
            elif i == 0 and limpio in PREFIJOS:
                afijos.append(limpio + "-")
        d["raices"], d["afijos"], d["fuente_raices"] = raices, afijos, origen_partes

    print("5/5 Significados, orden y pistas…")
    unidades = []
    for clave, d in info.items():
        grupos = d["grupos"][:MAX_SIGNIFICADOS] or [{"trads": [], "sentido": ""}]
        for k, gr in enumerate(grupos):
            unidades.append({"clave": clave, "k": k, "grupo": gr,
                             "orden_frec": d["zipf"] - PENALIZACION_SIGNIFICADO * k})
    unidades.sort(key=lambda u: -u["orden_frec"])

    principal = {u["clave"]: u for u in unidades if u["k"] == 0}
    colocadas, ordenadas, en_curso = set(), [], set()

    def colocar(u):
        clave = u["clave"]
        if id(u) in colocadas:
            return
        if u["k"] == 0 and clave not in en_curso:
            en_curso.add(clave)
            for r in info[clave]["raices"]:
                if r in principal:
                    colocar(principal[r])
        if id(u) not in colocadas:
            colocadas.add(id(u))
            ordenadas.append(u)

    for u in unidades:
        if len(ordenadas) >= args.total:
            break
        if u["k"] > 0 and id(principal[u["clave"]]) not in colocadas:
            continue  # un significado secundario nunca va antes que el principal
        colocar(u)
    ordenadas = ordenadas[: args.total]

    def traduccion_principal(clave):
        u = principal.get(clave)
        return u["grupo"]["trads"][0] if u and u["grupo"]["trads"] else \
            info[clave]["glosa_en"].split(";")[0]

    columnas = ["orden", "lema", "categoria", "significado_n", "traduccion_es", "fuente_traduccion",
                "sentido_de", "glosa_en", "articulo", "genero", "plural",
                "presente_3sg", "preterito", "participio", "auxiliar", "tipo_verbo", "separable",
                "comparativo", "superlativo", "caso",
                "raices", "afijos", "fuente_raices", "parecido_es", "parecido_en", "origen",
                "transparencia", "pista", "zipf", "zipf_escrito", "zipf_hablado", "ipa"]
    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    stats = collections.Counter()
    with open(SALIDA, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=columnas)
        w.writeheader()
        for n, u in enumerate(ordenadas, 1):
            (lema, cat), d, gr = u["clave"], info[u["clave"]], u["grupo"]
            trads = gr["trads"]
            es = parecido_espanol(lema, cat, trads) if trads else ""
            en = parecido_ingles(lema, d["cognados_en"], d["glosa_en"])
            origen, latino = describir_origen(d["cadena"])
            pistas = []
            if es:
                pistas.append(f"Parecida al español: {es}")
            if en:
                pistas.append(f"Como el inglés «{en}»")
            if d["raices"] or d["afijos"]:
                trozos = [f"{r[0]} ({traduccion_principal(r)})" for r in d["raices"]]
                trozos += [f"{a} ({(SUFIJOS if a.startswith('-') else PREFIJOS)[a.strip('-')]})"
                           for a in d["afijos"]]
                pistas.append(" + ".join(trozos))
            if latino and not es:
                pistas.append(origen[:1].upper() + origen[1:])
            transparencia = ("español" if es else "inglés" if en else
                             "partes" if d["raices"] else "latín/romance" if latino else "opaca")
            stats[transparencia] += 1
            stats["con_traduccion_es"] += bool(trads)
            w.writerow({
                "orden": n, "lema": lema, "categoria": cat, "significado_n": u["k"] + 1,
                "traduccion_es": ", ".join(trads[:4]) if trads else d["glosa_en"].split(";")[0],
                "fuente_traduccion": d["fuente_traduccion"] if trads else "Wiktionary (inglés)",
                "sentido_de": gr["sentido"][:90], "glosa_en": d["glosa_en"],
                **{c: d.get(c, "") for c in ("articulo", "genero", "plural", "presente_3sg",
                                             "preterito", "participio", "auxiliar", "tipo_verbo",
                                             "separable", "comparativo", "superlativo", "caso",
                                             "ipa", "fuente_raices")},
                "raices": " + ".join(r[0] for r in d["raices"]), "afijos": " ".join(d["afijos"]),
                "parecido_es": es, "parecido_en": en, "origen": origen,
                "transparencia": transparencia, "pista": " · ".join(pistas),
                "zipf": round(d["zipf"], 3),
                "zipf_escrito": round(d["zipf_derewo"], 3) if d["zipf_derewo"] else "",
                "zipf_hablado": round(d["zipf_subtlex"], 3) if d["zipf_subtlex"] else "",
            })
            stats[cat] += 1
    print(f"\nEscrito {SALIDA} con {len(ordenadas)} palabras (significados).")
    for k, v in sorted(stats.items(), key=lambda x: -x[1]):
        print(f"    {k}: {v}")


if __name__ == "__main__":
    main()
