#!/usr/bin/env python3
"""Baut aus der PWA eine einzelne, in sich geschlossene HTML-Datei.

Nützlich zum schnellen Ausprobieren (verschicken, per Datei öffnen, in einem
Viewer einbetten) - die installierbare PWA bleibt die Mehr-Datei-Variante mit
Service Worker und Manifest.

Aufruf:  python3 tools/build_single.py [ziel.html]
"""
import base64
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENTRY = "app.js"

IMPORT_RE = re.compile(
    r"^import\s+(?:\*\s+as\s+(?P<ns>\w+)|\{(?P<names>[^}]*)\})\s+from\s+'\./(?P<file>[\w.]+)';",
    re.M | re.S,
)
EXPORT_FN_RE = re.compile(r"^export\s+(?:async\s+)?function\s+(\w+)", re.M)
EXPORT_DECL_RE = re.compile(r"^export\s+(?:const|let|var|class)\s+(\w+)", re.M)


def dependencies(name: str) -> list[str]:
    """Welche Geschwistermodule importiert diese Datei?"""
    source = (ROOT / "js" / name).read_text(encoding="utf-8")
    return [m.group("file") for m in IMPORT_RE.finditer(source)]


def module_order(entry: str = ENTRY) -> list[str]:
    """Alle erreichbaren Module in Abhängigkeitsreihenfolge (Tiefensuche).

    Wird automatisch aus den import-Zeilen gebildet, damit ein neues Modul
    nicht vergessen werden kann.
    """
    order: list[str] = []
    seen: set[str] = set()
    stack: list[str] = []

    def visit(name: str) -> None:
        if name in order:
            return
        if name in stack:
            raise SystemExit(f"Zyklischer Import: {' -> '.join(stack + [name])}")
        if not (ROOT / "js" / name).exists():
            raise SystemExit(f"Importiertes Modul fehlt: js/{name}")
        stack.append(name)
        for dep in dependencies(name):
            visit(dep)
        stack.pop()
        seen.add(name)
        order.append(name)

    visit(entry)
    return order


def transform(source: str) -> tuple[str, list[str]]:
    """ESM -> Registry-Modul: Importe zu __req(), Exporte einsammeln."""
    exported = EXPORT_FN_RE.findall(source) + EXPORT_DECL_RE.findall(source)

    def replace_import(match):
        target = f"__req('{match.group('file')}')"
        if match.group("ns"):
            return f"const {match.group('ns')} = {target};"
        names = " ".join(match.group("names").split())
        return f"const {{ {names} }} = {target};"

    body = IMPORT_RE.sub(replace_import, source)
    body = re.sub(r"^export\s+", "", body, flags=re.M)
    return body, exported


def build(target: Path, artifact: bool = False) -> None:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "css" / "app.css").read_text(encoding="utf-8")
    icon = (ROOT / "icons" / "icon.svg").read_bytes()
    icon_uri = "data:image/svg+xml;base64," + base64.b64encode(icon).decode()

    parts = [
        "/* Schlummer - Ein-Datei-Build, erzeugt von tools/build_single.py */",
        "const __mods = {};",
        "const __cache = {};",
        "function __req(name) {",
        "  if (!(name in __cache)) __cache[name] = __mods[name]();",
        "  return __cache[name];",
        "}",
    ]
    modules = module_order()
    for name in modules:
        body, exported = transform((ROOT / "js" / name).read_text(encoding="utf-8"))
        exports = ", ".join(sorted(set(exported)))
        parts.append(f"__mods['{name}'] = function () {{\n{body}\nreturn {{ {exports} }};\n}};")
    # Der Einstiegspunkt wird zuletzt ausgeführt.
    parts.append(f"__req('{ENTRY}');")
    bundle = "\n".join(parts)
    # Im Ein-Datei-Build gibt es keinen icons/-Ordner: Cover und Benachrichtigungs-
    # Symbol zeigen sonst ins Leere (404 in der Konsole).
    bundle = bundle.replace("'icons/icon-192.png'", f"'{icon_uri}'")
    bundle = bundle.replace("type: 'image/png'", "type: 'image/svg+xml'")

    html = html.replace(
        '    <link rel="stylesheet" href="css/app.css" />',
        f"    <style>\n{css}\n    </style>",
    )
    html = html.replace('    <link rel="manifest" href="manifest.webmanifest" />\n', "")
    html = html.replace(
        '    <link rel="icon" href="icons/icon.svg" type="image/svg+xml" />\n'
        '    <link rel="apple-touch-icon" href="icons/icon-192.png" />',
        f'    <link rel="icon" href="{icon_uri}" type="image/svg+xml" />\n'
        f'    <link rel="apple-touch-icon" href="{icon_uri}" />',
    )
    html = html.replace(
        '    <script type="module" src="js/app.js"></script>',
        f'    <script type="module">\n{bundle}\n    </script>',
    )

    # Ohne eigene Dateien gibt es auch keinen Service Worker zu registrieren.
    html = re.sub(
        r"if \('serviceWorker' in navigator\) \{.*?\n\}\n", "", html, flags=re.S
    )

    if artifact:
        # Viewer, die nur den Seiteninhalt einbetten, bekommen die Datei ohne
        # doctype/html/head/body - Titel zuerst, dann Stil, Markup, Skript.
        head = html.split("<body>", 1)[1].rsplit("</body>", 1)[0]
        style = html.split("<style>", 1)[1].split("</style>", 1)[0]
        html = f"<title>Schlummer</title>\n<style>\n{style}\n</style>\n{head}\n"

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(html, encoding="utf-8")
    print(f"{target} geschrieben ({len(html) / 1024:.0f} KB, {len(modules)} Module: {', '.join(modules)})")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--artifact"]
    artifact = "--artifact" in sys.argv
    default = "schlummer-artifact.html" if artifact else "schlummer.html"
    out = Path(args[0]) if args else ROOT / "dist" / default
    build(out, artifact=artifact)
