#!/usr/bin/env node
"use strict";
/**
 * Per-texture over-provisioning report for a Nexus (.nxz/.nxs) model.
 *
 * Over-provisioning = a node's texture carries more texels than its geometry can
 * ever show at the LOD where that node is selected. Nexus targets uniform
 * screen-space error, so at selection every node's triangles are ~the same pixel
 * size; the *needed* texels-per-triangle is therefore a single constant
 * (≈ the on-screen triangle area in texels) shared by every node and every model
 * at a given runtime target error. Any texture whose texels/triangle exceeds
 * that target is provisioning detail the viewer never resolves — but it still
 * occupies GPU cache at full resolution, because every loaded node uploads its
 * texture whole and the GPU only mip-samples it for display.
 *
 * This is computable from the index ALONE — per-patch triangle counts (from the
 * patch table) and texture pixel dimensions. No geometry decode, no OBJ needed.
 *
 * Usage:
 *   node overprovision.js file.nxz [--target-density=64] [--target-edge=8]
 *   node overprovision.js file.nxz --manifest plan.json   # per-texture downscale plan
 *   node overprovision.js file.nxz --bc4                   # snap target dims to mult. of 4 (BC/ASTC)
 *
 * --target-density D : allowed texels per triangle (default 64 ≈ 8 texels/edge).
 * --target-edge E    : convenience, sets density = E*E.
 * Calibrate D against a model you judge to look perfect at the runtime target
 * error (Arc_de_Triomphe sits at ~43; well-tuned models cluster 40–80).
 */

const fs = require("fs");
const path = require("path");
const { parseNexus, openTextureReader } = require("./lib/parseNexus");
const { imageInfo } = require("./lib/imageInfo");

const TEX_PROBE_BYTES = 1 << 16;
const RGBA = 4;

function main() {
    const argv = process.argv.slice(2);
    const opts = { targetDensity: 64, manifest: null, bc4: false, top: 15 };
    const files = [];
    for (const a of argv) {
        if (a.startsWith("--target-density=")) opts.targetDensity = parseFloat(a.split("=")[1]);
        else if (a.startsWith("--target-edge=")) opts.targetDensity = Math.pow(parseFloat(a.split("=")[1]), 2);
        else if (a.startsWith("--manifest=")) opts.manifest = a.split("=")[1];
        else if (a === "--manifest") opts.manifest = "overprovision-plan.json";
        else if (a === "--bc4") opts.bc4 = true;
        else if (a.startsWith("--top=")) opts.top = parseInt(a.split("=")[1], 10);
        else files.push(a);
    }
    if (files.length !== 1) {
        console.error("usage: node overprovision.js <file.nxz> [--target-density=N | --target-edge=N] [--manifest[=out.json]] [--bc4]");
        process.exit(1);
    }
    report(files[0], opts);
}

// faces attributed to each texture: within a node, patch p covers
// [prevLastTriangle, patch.lastTriangle) triangles; lastTriangle resets per node.
function textureFaces(nodes, textures) {
    const faces = new Float64Array(textures.length);
    for (const n of nodes) {
        let prev = 0;
        for (const p of n.patches) {
            const f = p.lastTriangle - prev;
            prev = p.lastTriangle;
            if (p.texture < faces.length) faces[p.texture] += f;
        }
    }
    return faces;
}

function snap(x, bc4) {
    x = Math.max(1, Math.round(x));
    if (bc4) x = Math.max(4, Math.round(x / 4) * 4);
    return x;
}

function report(file, opts) {
    const { nodes, textures } = parseNexus(file);
    const faces = textureFaces(nodes, textures);

    const read = openTextureReader(file);
    const rows = [];
    let curPx = 0, newPx = 0;
    try {
        for (const t of textures) {
            const d = imageInfo(read(t, TEX_PROBE_BYTES));
            const px = d.width * d.height;
            const f = faces[t.id] || 0;
            const density = f ? px / f : 0;
            // scale per side to bring density down to target (never upscale)
            const scale = density > opts.targetDensity ? Math.sqrt(opts.targetDensity / density) : 1;
            const tw = scale < 1 ? snap(d.width * scale, opts.bc4) : d.width;
            const th = scale < 1 ? snap(d.height * scale, opts.bc4) : d.height;
            const newP = tw * th;
            curPx += px; newPx += newP;
            rows.push({ id: t.id, w: d.width, h: d.height, format: d.format, faces: f, density, scale, tw, th, px, newP });
        }
    } finally {
        read.close();
    }

    const over = rows.filter((r) => r.scale < 0.995);
    const overPx = over.reduce((s, r) => s + r.px, 0);
    const fmtMB = (px) => (px * RGBA / (1 << 20)).toFixed(1);
    const fmtPct = (n, d) => (d ? (100 * n / d).toFixed(0) : "0");

    console.log(`\n${path.basename(file)} — over-provisioning @ target ${opts.targetDensity.toFixed(0)} texel/tri ` +
        `(~${Math.sqrt(opts.targetDensity).toFixed(1)} texels/edge)`);
    console.log(`  ${textures.length} textures; ${over.length} over-provisioned (${fmtPct(over.length, textures.length)}%), ` +
        `holding ${fmtPct(overPx, curPx)}% of all texels`);
    console.log(`  texture GPU (RGBA8): ${fmtMB(curPx)} MB → ${fmtMB(newPx)} MB after per-texture downscale ` +
        `(save ${fmtMB(curPx - newPx)} MB, ${fmtPct(curPx - newPx, curPx)}%)`);

    // distribution by over-provisioning factor
    const buckets = [[1, 2], [2, 4], [4, 8], [8, 16], [16, Infinity]];
    console.log("  over-provisioning factor distribution (by texel mass):");
    for (const [lo, hi] of buckets) {
        const sel = rows.filter((r) => r.density / opts.targetDensity >= lo && r.density / opts.targetDensity < hi);
        const m = sel.reduce((s, r) => s + r.px, 0);
        if (sel.length) console.log(`    ${lo}–${hi === Infinity ? "∞" : hi}×: ${sel.length} textures, ${fmtPct(m, curPx)}% of texels`);
    }

    // worst offenders by wasted texels
    const worst = [...rows].sort((a, b) => (b.px - b.newP) - (a.px - a.newP)).slice(0, opts.top);
    console.log(`  worst offenders (by texels saved):`);
    console.log("    " + "texId".padStart(6) + "dims".padStart(13) + "faces".padStart(9) +
        "tex/tri".padStart(9) + "over".padStart(7) + "→ new dims".padStart(13) + "save MB".padStart(9));
    for (const r of worst) {
        if (r.scale >= 0.995) continue;
        console.log("    " + String(r.id).padStart(6) + `${r.w}x${r.h}`.padStart(13) +
            String(r.faces).padStart(9) + r.density.toFixed(0).padStart(9) +
            (r.density / opts.targetDensity).toFixed(1).padStart(6) + "x" +
            `${r.tw}x${r.th}`.padStart(13) + fmtMB(r.px - r.newP).padStart(9));
    }

    if (opts.manifest) {
        // per-texture plan the reencode pass can consume: only entries needing a downscale.
        const plan = {
            file: path.basename(file), targetDensity: opts.targetDensity, bc4: opts.bc4,
            textures: rows.filter((r) => r.scale < 0.995).map((r) => ({
                id: r.id, offset: textures[r.id].offset, bytes: textures[r.id].bytes,
                width: r.w, height: r.h, targetWidth: r.tw, targetHeight: r.th,
                scale: +r.scale.toFixed(4), faces: r.faces, density: +r.density.toFixed(1),
            })),
        };
        fs.writeFileSync(opts.manifest, JSON.stringify(plan, null, 2));
        console.log(`  wrote downscale plan for ${plan.textures.length} textures → ${opts.manifest}`);
    }
}

main();
