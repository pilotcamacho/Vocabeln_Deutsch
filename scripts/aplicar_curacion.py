"""Aplica la curación manual (data/curacion/) sobre la lista maestra.

La maestra no se modifica: se regenera con construir_lista_maestra.py y esta
curación se vuelve a aplicar encima. Las filas se identifican por
lema + categoria + significado_n, no por orden.

Salida: data/lista_curada.csv (UTF-8 con BOM), con las columnas de la maestra
más tipo_pista, orden_maestra, significado_maestra, curado y nota_curacion. Las pistas
automáticas se rehacen con las raíces y traducciones curadas. significado_maestra
conserva la numeración de la maestra, que es la que usa el registro de ids
(scripts/exportar_palabras.py), porque significado_n se renumera tras los descartes.

Uso:  python -I -X utf8 scripts/aplicar_curacion.py
"""

import collections
import csv
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from construir_lista_maestra import PREFIJOS, SUFIJOS  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent
MAESTRA = RAIZ / "data" / "lista_maestra.csv"
CURACION = RAIZ / "data" / "curacion"
SALIDA = RAIZ / "data" / "lista_curada.csv"

# etimología: afirma algo verificable sobre el origen; truco: parecido de sonido o
# imagen inventado; uso: expresiones y ejemplos reales
TIPOS_PISTA = {"etimología", "truco", "uso"}


def leer(ruta):
    with open(ruta, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def clave(fila):
    return (fila["lema"], fila["categoria"], fila["significado_n"])


def glosa_corta(traduccion):
    """La primera opción de una traducción, sin ejemplos: «razón, motivo; suelo» → «razón»."""
    primera = re.split(r"[;,]", traduccion)[0]
    return re.sub(r"\s*\(.*", "", primera).strip()


def rehacer_pistas_automaticas(filas, lemas_alemanes):
    """Rehace las pistas automáticas con las raíces, afijos y traducciones ya curados.

    La maestra compone la pista con la traducción original de cada raíz, así que una
    raíz mal traducida (p. ej. «hin (tomado)») contamina todas sus derivadas.
    También quita los falsos parecidos con el inglés que son palabras alemanas.
    """
    glosas = {}
    for r in sorted(filas, key=lambda r: -float(r["zipf"] or 0)):
        if r["significado_n"] == "1":
            glosas.setdefault(r["lema"], glosa_corta(r["traduccion_es"]))

    for r in filas:
        if r["tipo_pista"] != "automática":
            continue
        partes = []
        for trozo in r["pista"].split(" · "):
            if trozo.startswith("Como el inglés «"):
                en = trozo[len("Como el inglés «"):-1].lower()
                lema = r["lema"].lower()
                raices = {x.lower() for x in r["raices"].split(" + ")}
                # «arbeiten» para Arbeiter, «heiliger» para Heilige, «stopfen» para stoppen
                aleman = en in raices or en == lema + "r" or (
                    en.endswith("en") and en in lemas_alemanes)
                if en != lema and aleman:
                    continue
                partes.append(trozo)
            elif trozo.startswith("Parecida al español:") or trozo == r["origen"][:1].upper() + r["origen"][1:]:
                partes.append(trozo)
        trozos = [f"{raiz} ({glosas[raiz]})" if glosas.get(raiz) else raiz
                  for raiz in r["raices"].split(" + ") if raiz]
        for afijo in re.findall(r"\S+(?: \([^)]*\))?", r["afijos"]):
            if "(" in afijo.replace("da(r)-", ""):
                trozos.append(afijo)
            elif afijo == "dar-" and r["categoria"] == "adverbio":
                trozos.append("da(r)- (ahí)")
            else:
                tabla = SUFIJOS if afijo.startswith("-") else PREFIJOS
                desc = tabla.get(afijo.strip("-"))
                trozos.append(f"{afijo} ({desc})" if desc else afijo)
        if trozos:
            # Mismo orden que en la maestra: parecidos, partes, origen
            n = sum(p.startswith(("Parecida", "Como el")) for p in partes)
            partes.insert(n, " + ".join(trozos))
        r["pista"] = " · ".join(partes)
        if not r["pista"]:
            r["tipo_pista"] = ""


def main():
    maestra = leer(MAESTRA)
    columnas = list(maestra[0].keys())
    por_clave = {clave(r): r for r in maestra}
    palabras = {(r["lema"], r["categoria"]) for r in maestra}
    errores = []

    def comprobar(fila, archivo):
        """Una clave con significado_n vacío se refiere a la palabra entera."""
        if fila["significado_n"]:
            ok = clave(fila) in por_clave
        else:
            ok = (fila["lema"], fila["categoria"]) in palabras
        if not ok:
            errores.append(f"{archivo}: no existe {fila['lema']} ({fila['categoria']}) {fila['significado_n']}")
        return ok

    def aplica_a(fila, r):
        return (r["lema"], r["categoria"]) == (fila["lema"], fila["categoria"]) and (
            not fila["significado_n"] or r["significado_n"] == fila["significado_n"])

    notas = collections.defaultdict(list)

    # --- 1. Descartes ---------------------------------------------------------------
    descartados = set()
    for d in leer(CURACION / "descartes.csv"):
        if comprobar(d, "descartes.csv"):
            for r in maestra:
                if aplica_a(d, r):
                    descartados.add(clave(r))

    # --- 2. Correcciones ------------------------------------------------------------
    vistos = set()
    for c in leer(CURACION / "correcciones.csv"):
        if c["columna"] not in columnas:
            errores.append(f"correcciones.csv: columna desconocida «{c['columna']}» en {c['lema']}")
            continue
        if not comprobar(c, "correcciones.csv"):
            continue
        k = (*clave(c), c["columna"])
        if k in vistos:
            errores.append(f"correcciones.csv: corrección repetida de {c['columna']} en {c['lema']} {c['significado_n']}")
        vistos.add(k)
        for r in maestra:
            if aplica_a(c, r):
                r[c["columna"]] = c["valor"]
                if c["columna"] == "traduccion_es":
                    r["fuente_traduccion"] = "curada"
                if c["motivo"]:
                    notas[clave(r)].append(f"{c['columna']}: {c['motivo']}")

    # --- 3. Pistas (la de un significado concreto gana a la de la palabra) -----------
    for r in maestra:
        r["tipo_pista"] = "automática" if r["pista"] else ""
    pistas = sorted(leer(CURACION / "pistas.csv"), key=lambda p: bool(p["significado_n"]))
    for p in pistas:
        if p["tipo_pista"] not in TIPOS_PISTA:
            errores.append(f"pistas.csv: tipo_pista «{p['tipo_pista']}» no válido en {p['lema']}")
        if comprobar(p, "pistas.csv"):
            for r in maestra:
                if aplica_a(p, r):
                    r["pista"] = p["pista"]
                    r["tipo_pista"] = p["tipo_pista"]

    if errores:
        print("Errores en la curación:")
        for e in errores:
            print("   ", e)
        sys.exit(1)

    # --- 4. Tramos revisados ----------------------------------------------------------
    tramos = leer(CURACION / "tramos.csv")

    def estado_tramo(orden):
        for t in tramos:
            if int(t["desde"]) <= orden <= int(t["hasta"]):
                return t["estado"]
        return ""

    # --- 5. Salida: sin descartes, significados y orden renumerados -------------------
    salida = []
    contador = collections.Counter()
    for r in maestra:
        if clave(r) in descartados:
            continue
        nota = "; ".join(notas[clave(r)])
        contador[(r["lema"], r["categoria"])] += 1
        r = dict(r)
        r["orden_maestra"] = r["orden"]
        r["significado_maestra"] = r["significado_n"]
        r["orden"] = str(len(salida) + 1)
        r["significado_n"] = str(contador[(r["lema"], r["categoria"])])
        r["curado"] = estado_tramo(int(r["orden_maestra"]))
        r["nota_curacion"] = nota
        salida.append(r)

    # --- 6. Pistas automáticas rehechas con los datos curados -------------------------
    antes = {clave(r): r["pista"] for r in salida}
    rehacer_pistas_automaticas(salida, {r["lema"].lower() for r in maestra})
    rehechas = sum(r["pista"] != antes[clave(r)] for r in salida)

    with open(SALIDA, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=columnas + ["tipo_pista", "orden_maestra", "significado_maestra",
                                                 "curado", "nota_curacion"])
        w.writeheader()
        w.writerows(salida)

    print(f"Escrito {SALIDA} con {len(salida)} palabras (significados).")
    print(f"    descartados: {len(descartados)}")
    print(f"    columnas corregidas: {len(vistos)}")
    print(f"    pistas manuales: {len(pistas)}")
    print(f"    pistas automáticas rehechas: {rehechas}")
    print(f"    filas en tramos revisados: {sum(1 for r in salida if r['curado'])}")


if __name__ == "__main__":
    main()
