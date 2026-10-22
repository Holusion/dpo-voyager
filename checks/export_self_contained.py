#!/usr/bin/env python3
"""Build an exportable static Voyager Story demo for Mausolée_Seclin."""

import argparse
import json
import os
import re
import shutil
import subprocess
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit


PROJECT = Path(__file__).resolve().parents[1]
SOURCE = PROJECT / "files" / "Mausolée_Seclin"
OUTPUT = PROJECT / "dist" / "self-contained"


class ArticleReferences(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = set()

    def handle_starttag(self, tag, attrs):
        for name, value in attrs:
            if name in ("src", "href") and value:
                url = urlsplit(value)
                if not url.scheme and not url.netloc and url.path and not url.path.startswith("/"):
                    self.paths.add(unquote(url.path))


def scene_files():
    document = json.loads((SOURCE / "scene.svx.json").read_text(encoding="utf-8"))
    found = {Path("scene.svx.json")}

    def visit(value):
        if isinstance(value, dict):
            for item in value.values():
                visit(item)
        elif isinstance(value, list):
            for item in value:
                visit(item)
        elif isinstance(value, str):
            url = urlsplit(value)
            if url.scheme or url.netloc or value.startswith("/"):
                return
            candidate = (SOURCE / value).resolve()
            if candidate.is_file() and candidate.is_relative_to(SOURCE.resolve()):
                found.add(candidate.relative_to(SOURCE))
            elif Path(url.path).suffix.lower() in (".glb", ".gltf", ".png", ".jpg", ".jpeg", ".html", ".mp3", ".hdr", ".vtt"):
                raise FileNotFoundError(f"Scene asset missing: {value}")

    visit(document)
    for article in list(found):
        if article.suffix != ".html":
            continue
        parser = ArticleReferences()
        parser.feed((SOURCE / article).read_text(encoding="utf-8"))
        for reference in parser.paths:
            candidate = (SOURCE / article.parent / reference).resolve()
            if not candidate.is_file() or not candidate.is_relative_to(SOURCE.resolve()):
                raise FileNotFoundError(f"Article asset missing: {article}: {reference}")
            found.add(candidate.relative_to(SOURCE))
    return sorted(found)


def copy(source, relative):
    destination = OUTPUT / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    destination.chmod(0o644)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-build", action="store_true", help="Use the existing production Story bundle")
    args = parser.parse_args()

    if not args.skip_build:
        env = dict(os.environ, VOYAGER_OFFLINE="true")
        subprocess.run(
            [str(PROJECT / "node_modules/.bin/webpack"), "--mode=production", "--env=app=story"],
            cwd=PROJECT / "source/client", env=env, check=True,
        )

    files = scene_files()
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    OUTPUT.mkdir(parents=True)

    for relative in files:
        copy(SOURCE / relative, Path("demo") / relative)

    for relative in (
        "js/voyager-story.min.js", "js/voyager-story.min.js.LICENSE.txt",
        "css/voyager-story.min.css",
    ):
        copy(PROJECT / "dist" / relative, Path(relative))

    for relative in (
        "favicon.png",
        "images/logo-full.svg", "images/logo-sm.svg", "images/spinner.svg",
        "images/voyager-75grey.svg",
        "images/studio_small_08_1k.hdr", "images/capture_tent_mockup-v2-1k.hdr",
        "images/spruit_sunrise_1k_HDR.hdr",
        "js/draco/draco_decoder.js", "js/draco/draco_decoder.wasm",
        "js/draco/draco_wasm_wrapper.js",
        "fonts/Amiri-Regular.woff2", "fonts/Amiri-Bold.woff2",
        "fonts/HindSiliguri-Regular.woff2", "fonts/HindSiliguri-Bold.woff2",
    ):
        copy(PROJECT / "assets" / relative, Path(relative))

    for source in sorted((PROJECT / "assets/language").glob("string.resources.*.json")):
        copy(source, Path("language") / source.name)
    for name in ("LICENSE.md", "ATTRIBUTIONS.md", "3RD_PARTY_LICENSES.txt"):
        copy(PROJECT / name, Path(name))

    font_css = (PROJECT / "assets/fonts/fonts.css").read_text(encoding="utf-8")
    font_css = re.sub(r",\s*url\(https?://[^)]*\)\s*format\('[^']*'\)", "", font_css)
    if "https://" in font_css or "http://" in font_css:
        raise ValueError("External font URL remains in fonts.css")
    (OUTPUT / "fonts/fonts.css").write_text(font_css, encoding="utf-8")

    (OUTPUT / "index.html").write_text('''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Voyager panels — Mausolée de Seclin</title>
  <link rel="icon" href="favicon.png">
  <link rel="stylesheet" href="fonts/fonts.css">
  <link rel="stylesheet" href="css/voyager-story.min.css">
  <style>
    body { background: #303030; }
    #demo-status { position: fixed; z-index: 10000; top: 12px; right: 12px;
      max-width: 28em; padding: 8px 12px; color: white; background: #272727;
      border-radius: 3px; font: 14px sans-serif; box-shadow: 0 2px 10px #0008; }
    #demo-status[hidden] { display: none; }
  </style>
  <script defer src="js/voyager-story.min.js"></script>
  <script defer src="load-demo.js"></script>
</head>
<body>
  <voyager-story mode="standalone" resourceRoot="./" dracoRoot="./js/draco/"></voyager-story>
  <div id="demo-status" role="status">Loading Mausolée de Seclin…</div>
</body>
</html>
''', encoding="utf-8")

    paths = json.dumps([str(path) for path in files], ensure_ascii=False)
    (OUTPUT / "load-demo.js").write_text('''window.addEventListener("DOMContentLoaded", async () => {
  const status = document.getElementById("demo-status");
  try {
    const app = window.voyagerStory;
    const manager = app.system.getComponent("CVStandaloneFileManager");
    const root = new URL("demo/", document.baseURI);
    const paths = ''' + paths + ''';
    const contents = await Promise.all(paths.map(async path => {
      const response = await fetch(new URL(path, root));
      if (!response.ok) throw new Error(`Could not load ${path}: ${response.status}`);
      return [path, await response.blob()];
    }));
    for (const [path, blob] of contents) manager.addFile(path, [blob]);
    app.setBaseUrl(root.href);
    await app.loadDocument("scene.svx.json");
    status.hidden = true;
    window.voyagerDemoReady = true;
  } catch (error) {
    status.textContent = `Demo failed to load: ${error.message}`;
    status.setAttribute("role", "alert");
    window.voyagerDemoError = error;
    console.error(error);
  }
});
''', encoding="utf-8")

    (OUTPUT / "README.txt").write_text('''Voyager panels demo — Mausolée de Seclin

Copy this entire folder to any static HTTP(S) server, then open index.html.
It also works under a subdirectory. Browsers do not permit the file:// URL
scheme for this demo because the page fetches its local scene files.

To preview locally from this folder:
    python3 -m http.server 8000
Then open http://localhost:8000/.

The folder includes the Story app, its local UI resources and decoders, the
scene's referenced models, articles, images, and distribution licenses. No
Voyager backend or external CDN is required. Changes made in the browser are
local to that session; use the standalone Save control to download a ZIP.

To rebuild from the repository, run checks/export_self_contained.py with
Node.js and the project's installed npm dependencies available.
''', encoding="utf-8")
    print(f"Exported {len(files)} scene files to {OUTPUT}")


if __name__ == "__main__":
    main()
