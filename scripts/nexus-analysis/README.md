# Nexus model memory analysis

Dependency-free Node scripts to inspect the **GPU-memory footprint** of Nexus
(`.nxz` / `.nxs`) models, broken down by LOD level, and to project what texture
optimizations would actually save at runtime.

Motivation: at runtime, texture data dominates the GPU cache (80–90% observed),
and the cache is usually the limiting factor. The cache holds a *cut* through
the LOD DAG — every loaded node uploads its texture **at full resolution**; the
GPU only mip-samples it for display. So a node whose texture is finer than its
geometry needs wastes cache permanently. These scripts quantify that.

## Usage

```bash
node scripts/nexus-analysis/analyze.js                 # all files/*.nxz, *.nxs
node scripts/nexus-analysis/analyze.js files/Arc_de_Triomphe.nxz
node scripts/nexus-analysis/analyze.js --json file.nxz # machine-readable
node scripts/nexus-analysis/analyze.js --mips file.nxz # add mip overhead (×1.33)
node scripts/nexus-analysis/analyze.js --bpt-compressed=0.5 ...  # BC1/ETC1 target

# per-texture over-provisioning + downscale plan (feeds a reencode pass)
node scripts/nexus-analysis/overprovision.js file.nxz --target-edge=8
node scripts/nexus-analysis/overprovision.js file.nxz --target-edge=8 --bc4 --manifest=plan.json
```

`overprovision.js` flags individual textures that carry more texels than their
node's geometry can show, and (with `--manifest`) emits a per-texture
`{id, offset, bytes, width, height, targetWidth, targetHeight, scale}` plan a
reencode step can consume. It needs only the index (per-patch face counts +
texture dims) — no geometry decode, no source OBJ. `--bc4` snaps target dims to
multiples of 4 for block-compressed (BC/ASTC/KTX2) output.

No build step, no dependencies (Node ≥ 18 for `readBigUInt64LE`).

## What it computes

- **Parser** (`lib/parseNexus.js`) — reads only the 88-byte header + node/patch/
  texture index tables (ported from `assets/js/nexus/nexus.js`), so it is O(index)
  regardless of file size. Per node: vertices, faces, error, geometry bytes, LOD
  level (BFS depth over the patch DAG), and the textures it references with byte
  sizes.
- **Image prober** (`lib/imageInfo.js`) — pixel dimensions from each texture blob
  (JPEG SOF marker, PNG IHDR, KTX1/KTX2 header). Texture payloads are stored raw
  inside the `.nxz`; only the geometry is corto/meco-compressed.
- **GPU model** — JPEG/PNG decode to RGBA8 (4 B/texel); KTX2 (Basis→BC7/ASTC)
  modeled at 1 B/texel (`--bpt-compressed`). Geometry = `vsize·nvert + 6·nface`,
  matching the runtime's `nsize`.

### Key metric: texel density (texels per triangle)

Nexus targets uniform screen-space error, so rendered triangles are ~constant
pixel size across LODs — the *ideal* texels/triangle is therefore ~constant, and
≈ `(texels per triangle edge)²`. Deviations above the model's reference (finest
well-populated) level are wasted resolution. The **reference** is the level with
the most triangles, **not** the deepest level — the deepest is often a sparse
tail whose density is unrepresentative.

Three savings levers are reported per model:
- **[A] Density cap** — shrink only LODs that exceed the reference density.
  Lossless vs the model's own finest LOD.
- **[B] Global downscale** — shrink every texture uniformly (50%/side ⇒ −75%).
  Lowers delivered quality; worth it only where the model is over-provisioned.
- **[C] KTX2 / GPU compression** — BC7/ASTC ≈ 1 B/texel ⇒ ~75% off any
  JPEG-textured model, independent of resolution.

## Findings (files/ corpus, 2026-06)

Textures are **85–100%** of GPU for production photogrammetry models (the small
ones — Fontenay, MAN, monreale — are the geometry-dominated exceptions). So
textures are the right thing to attack.

**The original hypothesis — "downsize low-to-medium LODs" — gives almost nothing
([A] = 0–11%, mostly <3%).** `nxsbuild` already scales each node's texture in
step with its decimated geometry, so per-LOD texel density is already flat. There
is no per-level fat to trim.

**The real problem is global, cross-model over-provisioning.** Overall texel
density spans ~1000×:

| model | texel/tri | ~texels/edge | note |
|---|---|---|---|
| Fontenay / MAN / monreale | 2–6 | 1–2 | geometry-dominated, under-textured |
| Arc_de_Triomphe | 43 | 6.5 | well tuned |
| Diverticule / Seclin / Lascaux_HIGH | 65–76 | 8–9 | |
| Mimizan / Arthous_Ouest | 129–178 | 11–13 | |
| Chauvet / Portail_sud / Lascaux_4k | 499–583 | 22–24 | over-textured |
| Arthous_nord | 1257 | 35 | 8K textures (≈30 Mpx) on 142 nodes |
| Lascaux_full_8k | 2319 | 48 | 84 GB texture tree |

A node in Arthous_nord carries an ~8759×3501 texture — ~120 MB RGBA decoded —
far more detail than its geometry can show at the LOD where it is selected. That
resolution is invisible at runtime but still occupies cache. Models above
~10–12 texels/edge are paying for texels the viewer never sees.

**Actionable, in order of leverage:**
1. **GPU texture compression (KTX2/Basis → BC7/ASTC).** ~4× across the board,
   already prototyped: `Arc_de_Triomphe_ktx.nxz` measures 1214 MB GPU vs 4858 MB
   for the JPEG build (and 402 vs 663 MB on disk), same geometry. Biggest, lowest-
   risk win; combine with everything below.
2. **Standardize source texture resolution to a texels/edge budget** (e.g. ~10).
   Rebuild the over-dense models (Lascaux_8k, Arthous_nord, Chauvet, Portail_sud,
   Lascaux_4k) with smaller source textures or `nxsedit -T`. For Lascaux_8k that's
   ~25%/side ⇒ ~94% off its texture tree, before compression.
3. **Per-LOD downsizing: skip it.** The data shows it isn't where the memory is.

Caveat: texels/edge assumes triangles map roughly uniformly into UV space; UV
atlas waste isn't measured. The cross-model *ratios* are robust regardless.
