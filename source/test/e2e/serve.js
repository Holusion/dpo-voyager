const http = require("http");
const fs = require("fs");
const path = require("path");
// Repository root: this file lives in source/test/e2e.
const root = path.resolve(__dirname, "../../..");
const port = Number(process.env.PORT) || 8099;

const types = {
    ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
    ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
    ".jpg": "image/jpeg", ".glb": "model/gltf-binary", ".bin": "application/octet-stream",
    ".ktx2": "image/ktx2", ".wasm": "application/wasm", ".woff2": "font/woff2",
    ".woff": "font/woff", ".ttf": "font/ttf", ".mp3": "audio/mpeg", ".html5": "text/html",
};

http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    const file = p.startsWith("/files/")
        ? path.join(root, p)
        : path.join(root, "dist", p);

    fs.stat(file, (err, st) => {
        if (err || !st.isFile()) { res.writeHead(404); res.end("not found"); return; }
        res.writeHead(200, {
            "Content-Type": types[path.extname(file).toLowerCase()] || "application/octet-stream",
            "Content-Length": st.size,
            "Access-Control-Allow-Origin": "*",
        });
        fs.createReadStream(file).pipe(res);
    });
}).listen(port, () => console.log(`serving ${root}/dist and ${root}/files on ${port}`));
