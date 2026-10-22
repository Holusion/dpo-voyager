Voyager panels demo — Mausolée de Seclin

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
