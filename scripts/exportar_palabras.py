"""Exporta la lista curada a data/export/palabras.json con ids permanentes.

La app y la base de datos identifican cada significado por un número (palabra_id) que
se asigna una vez y nunca cambia ni se reutiliza. El registro está en
data/ids_palabras.csv, que solo crece. Cada fila del registro se enlaza con la clave
de la maestra: lema + categoria + significado_maestra (la numeración de la maestra, que
es la que usa la curación; significado_n de la curada se renumera tras los descartes).

Reglas en cada exportación:
- Significado nuevo: recibe el siguiente id libre.
- Significado que ya estaba: conserva su id.
- Significado descartado en la curación: su id pasa a «retirado» (no se borra).
- Clave que desaparece sin estar descartada, o cuya traducción en la maestra ha
  cambiado (p. ej. tras regenerar la maestra): el script se detiene y no escribe nada.
  Se decide a mano:
    · es el mismo significado → volver a ejecutar con --aceptar-cambios
    · es otro significado     → poner estado=retirado en el registro y volver a ejecutar
                                (la clave recibe un id nuevo)
    · desapareció de verdad   → volver a ejecutar con --aceptar-retiros
- Fusión de significados: escribir en reemplazado_por el id que lo sustituye; la app
  traslada allí el historial.

Uso:  python -I -X utf8 scripts/exportar_palabras.py [--aceptar-cambios] [--aceptar-retiros]
"""

import argparse
import csv
import datetime
import hashlib
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
MAESTRA = RAIZ / "data" / "lista_maestra.csv"
CURADA = RAIZ / "data" / "lista_curada.csv"
DESCARTES = RAIZ / "data" / "curacion" / "descartes.csv"
REGISTRO = RAIZ / "data" / "ids_palabras.csv"
SALIDA = RAIZ / "data" / "export" / "palabras.json"

COLUMNAS_REGISTRO = ["palabra_id", "lema", "categoria", "significado_maestra", "traduccion_maestra",
                     "estado", "reemplazado_por", "alta", "baja", "motivo"]

# Hasta este orden de la lista curada se estudian las dos direcciones (CLAUDE.md)
CORTE_DOS_DIRECCIONES = 8000

# Campos de la curada que pasan a la app (se omiten los vacíos)
CAMPOS = ["lema", "categoria", "significado_n", "traduccion_es", "articulo", "genero", "plural",
          "presente_3sg", "preterito", "participio", "auxiliar", "separable", "comparativo",
          "superlativo", "caso", "ipa", "pista", "tipo_pista"]


def leer(ruta):
    with open(ruta, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--aceptar-cambios", action="store_true",
                        help="la traducción de la maestra cambió pero es el mismo significado")
    parser.add_argument("--aceptar-retiros", action="store_true",
                        help="retirar los ids cuya clave ya no existe, aunque no estén descartados")
    args = parser.parse_args()
    hoy = datetime.date.today().isoformat()

    curada = leer(CURADA)
    if "significado_maestra" not in curada[0]:
        sys.exit("La lista curada no tiene significado_maestra: ejecuta antes scripts/aplicar_curacion.py")
    traduccion_maestra = {(r["lema"], r["categoria"], r["significado_n"]): r["traduccion_es"]
                          for r in leer(MAESTRA)}
    descartes = leer(DESCARTES)
    registro = leer(REGISTRO) if REGISTRO.exists() else []

    def clave(r):
        return (r["lema"], r["categoria"], r["significado_maestra"])

    def descartado(k):
        return any((d["lema"], d["categoria"]) == k[:2] and d["significado_n"] in ("", k[2])
                   for d in descartes)

    por_clave = {clave(r): r for r in curada}
    errores = []

    # --- 1. Comprobar los ids activos contra la lista actual ---------------------------
    activos = {}
    for e in registro:
        if e["estado"] != "activo":
            if not e["baja"]:  # retirado a mano en el registro
                e.update(baja=hoy, motivo=e["motivo"] or "retirado a mano")
            continue
        k = clave(e)
        if k in activos:
            errores.append(f"clave con dos ids activos: {k} → {activos[k]['palabra_id']} y {e['palabra_id']}")
        activos[k] = e
        if k not in por_clave:
            if descartado(k):
                e.update(estado="retirado", baja=hoy, motivo="descartado en la curación")
            elif args.aceptar_retiros:
                e.update(estado="retirado", baja=hoy, motivo="desapareció de la maestra")
            else:
                errores.append(f"id {e['palabra_id']} {k}: la clave ya no existe y no está descartada")
            continue
        actual = traduccion_maestra.get(k, "")
        if actual != e["traduccion_maestra"]:
            if args.aceptar_cambios:
                e["traduccion_maestra"] = actual
            else:
                errores.append(f"id {e['palabra_id']} {k}: la traducción de la maestra cambió "
                               f"«{e['traduccion_maestra']}» → «{actual}»")
    activos = {k: e for k, e in activos.items() if e["estado"] == "activo"}

    # --- 2. Ids nuevos, en orden de estudio --------------------------------------------
    siguiente = max((int(e["palabra_id"]) for e in registro), default=0) + 1
    nuevos = 0
    for r in curada:
        k = clave(r)
        if k not in activos:
            e = dict(palabra_id=str(siguiente), lema=k[0], categoria=k[1], significado_maestra=k[2],
                     traduccion_maestra=traduccion_maestra.get(k, ""), estado="activo",
                     reemplazado_por="", alta=hoy, baja="", motivo="")
            registro.append(e)
            activos[k] = e
            siguiente += 1
            nuevos += 1

    # --- 3. Comprobaciones de integridad ---------------------------------------------
    ids = [e["palabra_id"] for e in registro]
    if len(ids) != len(set(ids)):
        errores.append("hay ids repetidos en el registro")
    estado_de = {e["palabra_id"]: e["estado"] for e in registro}
    reemplazos = {}
    for e in registro:
        if e["reemplazado_por"]:
            if estado_de.get(e["reemplazado_por"]) != "activo":
                errores.append(f"id {e['palabra_id']}: reemplazado_por={e['reemplazado_por']} no es un id activo")
            elif e["estado"] != "retirado":
                errores.append(f"id {e['palabra_id']}: tiene reemplazado_por pero no está retirado")
            else:
                reemplazos[e["palabra_id"]] = e["reemplazado_por"]

    if errores:
        print("No se ha exportado nada. Problemas en el registro de ids:")
        for x in errores:
            print("   ", x)
        sys.exit(1)

    # --- 4. palabras.json ----------------------------------------------------------------
    id_de = {k: int(e["palabra_id"]) for k, e in activos.items()}
    # Las raíces se nombran por lema: se toma el significado más frecuente de ese lema
    id_de_lema = {}
    for r in curada:
        id_de_lema.setdefault(r["lema"], id_de[clave(r)])

    palabras, sin_raiz = [], set()
    for r in curada:
        p = {"id": id_de[clave(r)], "orden": int(r["orden"])}
        p.update({c: r[c] for c in CAMPOS if r[c]})
        p["significado_n"] = int(r["significado_n"])
        raices = []
        for raiz in filter(None, (x.strip() for x in r["raices"].split(" + "))):
            if raiz in id_de_lema and id_de_lema[raiz] != p["id"]:
                raices.append(id_de_lema[raiz])
            else:
                sin_raiz.add(raiz)
        if raices:
            p["raices"] = raices
        p["direcciones"] = ["de-es", "es-de"] if p["orden"] <= CORTE_DOS_DIRECCIONES else ["de-es"]
        p["validada"] = r["curado"] == "validado"
        palabras.append(p)

    contenido = {
        "palabras": palabras,
        "retiradas": sorted(int(e["palabra_id"]) for e in registro if e["estado"] == "retirado"),
        "reemplazos": {k: int(v) for k, v in sorted(reemplazos.items(), key=lambda x: int(x[0]))},
    }
    cuerpo = json.dumps(contenido, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    version = hashlib.sha256(cuerpo.encode("utf-8")).hexdigest()[:12]
    contenido = {"version": version, "generado": hoy, **contenido}

    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    with open(SALIDA, "w", encoding="utf-8") as f:
        json.dump(contenido, f, ensure_ascii=False, separators=(",", ":"))
    with open(REGISTRO, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNAS_REGISTRO)
        w.writeheader()
        w.writerows(sorted(registro, key=lambda e: int(e["palabra_id"])))

    retiradas_hoy = sum(1 for e in registro if e["baja"] == hoy)
    print(f"Escrito {SALIDA} (versión {version}, {SALIDA.stat().st_size / 1e6:.1f} MB)")
    print(f"    significados: {len(palabras)} ({sum(p['validada'] for p in palabras)} validados)")
    print(f"    ids nuevos: {nuevos} · retirados hoy: {retiradas_hoy} · retirados en total: "
          f"{len(contenido['retiradas'])} · reemplazos: {len(reemplazos)}")
    print(f"    raíces sin palabra en la lista (se ignoran): {len(sin_raiz)}")


if __name__ == "__main__":
    main()
