// Copia el contenido exportado (scripts/exportar_palabras.py) a public/, para que la PWA lo
// sirva y lo guarde sin conexión. Se ejecuta antes de dev y build.
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("public/datos", { recursive: true });
copyFileSync("data/export/palabras.json", "public/datos/palabras.json");
