# Nexus command-line tools

The [Nexus](https://github.com/cnr-isti-vclab/nexus) toolset for **creating and
editing multiresolution meshes** (`.nxs` / `.nxz`) — the format used by the
Voyager-Explorer Nexus prototype (see `source/client/io/NexusReader.ts`).

These are the official Linux x86-64 release binaries (Qt AppImage payload),
bundled here so the prototype is self-contained.

## Layout

| Path | Tracked in git? | What it is |
|------|-----------------|------------|
| `nexus-linux-x86_64.tar.gz` | no (`.gitignore`) | upstream release tarball (28 MB) |
| `runtime/` | no (`.gitignore`) | extracted binaries + Qt/GL libs (~72 MB) |
| `nxsbuild`, `nxsedit`, `nxscompress`, `nxsview` | yes | wrapper scripts |
| `extract.sh` | yes | re-extracts `runtime/` from the tarball |
| `README.md` | yes | this file |

`runtime/` and the tarball are git-ignored to keep the repository small. After a
fresh checkout, obtain the tarball (from the
[Nexus releases](https://github.com/cnr-isti-vclab/nexus/releases), saved as
`nexus-linux-x86_64.tar.gz`) and run:

```bash
./tools/nexus/extract.sh
```

## Usage

Always call the **wrapper scripts** (not `runtime/bin/*` directly) — they set
`LD_LIBRARY_PATH` to the bundled Qt/GL libraries:

```bash
cd tools/nexus

# Inspect an existing model (works on .nxs and .nxz)
./nxsedit ../../files/monreale.nxz --info
./nxsedit ../../files/monreale.nxz --show-dag    # per-node levels & errors

# Build a multiresolution .nxs from a mesh (ply / obj / stl)
./nxsbuild model.ply -o model.nxs

# Compress .nxs -> .nxz (smaller, streamed by the web loader)
./nxscompress model.nxs -o model.nxz
```

The web loader (`assets/js/nexus/`) reads both `.nxs` (uncompressed) and `.nxz`
(corto/meco-compressed). Reference a file from a Voyager document as a `Web3D`
`Model` asset; see `files/monreale.svx.json`.

### `nxsbuild` — build a multiresolution mesh

```
nxsbuild [input.ply|.obj|.stl ...] -o output.nxs [options]
```

Useful options:

| Flag | Meaning |
|------|---------|
| `-o <file>` | output `.nxs` filename |
| `-f <n>` | faces per patch (1000–32768, default 32768). Smaller = finer LOD granularity / less "pop" |
| `-t <n>` | triangles in the top (coarsest) node, default 4096 |
| `-s <f>` | decimation factor between levels, default 0.5 |
| `-S <n>` | skip decimation for the first n levels |
| `-C` / `-c` | save / don't save vertex colors |
| `-N` / `-n` | force / disable per-vertex normals |
| `-u` | drop textures and texture coordinates |
| `-v <f>` | vertex quantization grid |
| `-G` | move origin to the bounding-box centre |
| `-r <MB>` | RAM budget (approx), default 2000 |

> **Number of LOD levels** ≈ `log(total_faces / top_node_faces) / log(1/scaling)`.
> With defaults (`-t 4096`, `-s 0.5`) you need roughly `4096 · 2^L` faces for
> `L` levels. For 4+ distinct levels with multiple patches, feed it a mesh with
> well over ~1M faces and enough geometric detail that simplification can't
> collapse large regions cheaply (otherwise levels/patches get decimated away).

### `nxsedit` — inspect / edit / compress

```
nxsedit input.nxs|.nxz [options]
```

| Flag | Meaning |
|------|---------|
| `-i` / `--info` | summary (vertices, faces, nodes, sphere) |
| `-n` / `-q` / `-d` | print nodes / patches / DAG (per-node error & level) |
| `-p <file.ply>` | export the mesh to PLY |
| `-o <file.nxs>` | write a new nexus |
| `-z` | compress patches (use `-Z corto`) |
| `-e <err>` / `-t <tris>` / `-l <level>` | prune nodes by error / triangle budget / level |

### `nxscompress`

Convenience wrapper around `nxsedit -z` to produce a `.nxz` from a `.nxs`.

### `nxsview`

Standalone OpenGL viewer (needs a display / X server).
