#!/usr/bin/env node
"use strict";
/**
 * Analyze the texture vs geometry GPU-memory budget of Nexus (.nxz/.nxs) models,
 * broken down by LOD level, and project what downsizing coarse-level textures
 * would save.
 *
 * Why: at runtime, texture data dominates GPU cache (80-90% observed). The
 * cache holds a "cut" through the LOD DAG; coarser nodes are always resident
 * (they back every view) while fine nodes come and go. If coarse levels carry
 * more texels per triangle than the finest level actually needs, their textures
 * are oversized and can be shrunk with no visible loss relative to that LOD.
 *
 * Usage:
 *   node analyze.js [file.nxz ...]        # defaults to files/*.nxz
 *   node analyze.js --json file.nxz       # machine-readable per-level output
 *   node analyze.js --mips file.nxz       # include mipmap overhead (x1.333) in GPU sizes
 */

const fs = require("fs");
const path = require("path");
const { parseNexus, openTextureReader } = require("./lib/parseNexus");
const { imageInfo } = require("./lib/imageInfo");

// GPU bytes per texel after upload, by source format. JPEG/PNG decode to
// RGBA8 (4 B/texel). KTX2 (Basis/UASTC) transcodes to a block-compressed GPU
// format — BC7/ASTC 4x4 ≈ 1 B/texel, BC1/ETC1 ≈ 0.5. We assume 1.0 (the safe,
// high-quality target); override with --bpt-compressed=N.
const BYTES_PER_TEXEL = { jpeg: 4, png: 4, ktx2: 1, ktx1: 1, unknown: 4 };
const MIP_FACTOR = 4 / 3;             // full mip chain overhead
const TEX_PROBE_BYTES = 1 << 16;      // 64 KiB: enough to reach the JPEG SOF marker

function main() {
    const argv = process.argv.slice(2);
    const opts = { json: false, mips: false, bptCompressed: BYTES_PER_TEXEL.ktx2 };
    const files = [];
    for (const a of argv) {
        if (a === "--json") opts.json = true;
        else if (a === "--mips") opts.mips = true;
        else if (a.startsWith("--bpt-compressed=")) opts.bptCompressed = parseFloat(a.split("=")[1]);
        else files.push(a);
    }
    if (files.length === 0) {
        const dir = path.resolve(__dirname, "../../files");
        for (const f of fs.readdirSync(dir)) {
            if (f.endsWith(".nxz") || f.endsWith(".nxs")) files.push(path.join(dir, f));
        }
        files.sort();
    }

    const reports = files.map((f) => analyzeFile(f, opts));
    if (opts.json) {
        process.stdout.write(JSON.stringify(reports, null, 2) + "\n");
        return;
    }
    for (const r of reports) printReport(r, opts);
    if (reports.length > 1) printCrossSummary(reports, opts);
}

function analyzeFile(file, opts) {
    const mip = opts.mips ? MIP_FACTOR : 1;
    const { header, nodes, textures } = parseNexus(file);
    const fileSize = fs.statSync(file).size;

    // measure each texture's pixel dimensions once
    const read = openTextureReader(file);
    const texDims = new Array(textures.length);
    const formats = {};
    try {
        for (const t of textures) {
            const info = imageInfo(read(t, TEX_PROBE_BYTES));
            texDims[t.id] = info;
            formats[info.format] = (formats[info.format] || 0) + 1;
        }
    } finally {
        read.close();
    }

    const bpt = (fmt) => fmt === "ktx2" || fmt === "ktx1" ? opts.bptCompressed : (BYTES_PER_TEXEL[fmt] || 4);

    // per-level accumulation. Each node owns geometry + a set of textures.
    const levels = new Map();
    const levelOf = (lvl) => {
        if (!levels.has(lvl)) {
            levels.set(lvl, {
                level: lvl, nodes: 0, triangles: 0, vertices: 0,
                texPixels: 0, texCompBytes: 0, texGpu: 0, geomGpu: 0, textureCount: 0,
            });
        }
        return levels.get(lvl);
    };

    for (const n of nodes) {
        if (n.nface === 0 && n.textures.size === 0) continue; // skip empty sink
        const L = levelOf(n.level);
        L.nodes++;
        L.triangles += n.nface;
        L.vertices += n.nvert;
        L.geomGpu += n.geomBytes;
        for (const texId of n.textures) {
            const d = texDims[texId];
            const px = d ? d.width * d.height : 0;
            L.texPixels += px;
            L.texGpu += px * bpt(d ? d.format : "unknown") * mip;
            L.texCompBytes += textures[texId].bytes;
            L.textureCount++;
        }
    }

    const levelList = [...levels.values()].sort((a, b) => a.level - b.level);
    for (const L of levelList) {
        L.gpuTotal = L.texGpu + L.geomGpu;
        L.texelsPerTri = L.triangles ? L.texPixels / L.triangles : 0;
    }

    // Reference texel density: the dominant *finest* level — the one carrying the
    // most triangles. Nexus targets uniform screen-space error, so rendered
    // triangles are ~constant pixel size across LODs and the ideal texel/triangle
    // is ~constant. We must NOT use the deepest level as the reference: it is
    // often a sparse tail (a handful of nodes in one over-detailed region) whose
    // density is unrepresentative and would make every other level look bloated.
    const refLevel = levelList.reduce((a, b) => (b.triangles > (a ? a.triangles : 0) ? b : a), null);
    const refDensity = refLevel ? refLevel.texelsPerTri : 0;
    for (const L of levelList) {
        L.densityRatio = refDensity ? L.texelsPerTri / refDensity : 1;
        L.isRef = L === refLevel;
    }

    return {
        file, name: path.basename(file), fileSize, header, formats,
        textureCount: textures.length, levels: levelList,
        totals: aggregate(levelList),
        refDensity, refLevelIndex: refLevel ? refLevel.level : -1,
    };
}

function aggregate(levelList) {
    const t = { triangles: 0, texPixels: 0, texCompBytes: 0, texGpu: 0, geomGpu: 0, gpuTotal: 0 };
    for (const L of levelList) {
        t.triangles += L.triangles;
        t.texPixels += L.texPixels;
        t.texCompBytes += L.texCompBytes;
        t.texGpu += L.texGpu;
        t.geomGpu += L.geomGpu;
        t.gpuTotal += L.gpuTotal;
    }
    return t;
}

// ---- downsizing projection ----------------------------------------------
// Scenario: cap every level's texel density at the finest level's density.
// A level with densityRatio R > 1 carries R x more texels/triangle than the
// finest LOD; shrinking its textures by 1/sqrt(R) per side brings it to parity
// (texel count scales with area = side^2), with no loss relative to that LOD.
function projectDensityCap(levelList) {
    let saved = 0, after = 0;
    const perLevel = levelList.map((L) => {
        const ratio = L.densityRatio;
        const keep = ratio > 1 ? 1 / ratio : 1;            // texel-area scale factor
        const newGpu = L.texGpu * keep;
        const scalePerSide = Math.sqrt(keep);
        saved += L.texGpu - newGpu;
        after += newGpu;
        return { level: L.level, scalePerSide, newTexGpu: newGpu, savedTexGpu: L.texGpu - newGpu };
    });
    return { perLevel, saved, after };
}

// ---- formatting ----------------------------------------------------------
const MB = 1 << 20;
const fmtMB = (b) => (b / MB).toFixed(1);
const fmtMP = (px) => (px / 1e6).toFixed(1);
const pct = (n, d) => (d ? (100 * n / d).toFixed(0) : "0");
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

function printReport(r, opts) {
    const h = r.header;
    const kind = h.corto ? "corto" : h.meco ? "meco" : "raw";
    const fmtList = Object.entries(r.formats).map(([k, v]) => `${k}x${v}`).join(" ");
    console.log("\n" + "=".repeat(92));
    console.log(`${r.name}  —  ${fmtMB(r.fileSize)} MB on disk`);
    console.log(`  ${h.verticesCount.toLocaleString()} verts, ${h.facesCount.toLocaleString()} faces, ` +
        `${h.nodesCount} nodes, ${r.textureCount} textures (${kind}); texture fmt: ${fmtList}`);
    const globalDensity = r.totals.triangles ? r.totals.texPixels / r.totals.triangles : 0;
    console.log(`  GPU model: ${fmtMB(r.totals.texGpu)} MB textures + ${fmtMB(r.totals.geomGpu)} MB geometry ` +
        `= ${fmtMB(r.totals.gpuTotal)} MB  (textures ${pct(r.totals.texGpu, r.totals.gpuTotal)}%)` +
        (opts.mips ? "  [incl. mips]" : ""));
    console.log(`  Texel density: ${globalDensity.toFixed(0)} texel/tri overall ` +
        `(~${Math.sqrt(globalDensity).toFixed(1)} texels per triangle edge); ` +
        `reference level ${r.refLevelIndex} = ${r.refDensity.toFixed(0)} texel/tri`);
    console.log("-".repeat(92));
    console.log("  " + pad("lvl", 5) + padL("nodes", 6) + padL("tris", 10) + padL("texMP", 8) +
        padL("texGPU", 9) + padL("geoGPU", 9) + padL("tex%", 6) + padL("texel/tri", 11) + padL("vs ref", 9));
    for (const L of r.levels) {
        console.log("  " + pad(L.level + (L.isRef ? "*" : ""), 5) + padL(L.nodes, 6) +
            padL(L.triangles.toLocaleString(), 10) +
            padL(fmtMP(L.texPixels), 8) + padL(fmtMB(L.texGpu), 9) + padL(fmtMB(L.geomGpu), 9) +
            padL(pct(L.texGpu, L.gpuTotal) + "%", 6) +
            padL(L.texelsPerTri.toFixed(0), 11) + padL(L.densityRatio.toFixed(2) + "x", 9));
    }
    console.log("-".repeat(92));

    // Lever A — per-level density cap: shrink only levels that exceed the reference.
    const proj = projectDensityCap(r.levels);
    console.log(`  [A] Density cap — shrink levels above the reference (${r.refDensity.toFixed(0)} texel/tri) down to it:`);
    const interesting = proj.perLevel.filter((p) => p.scalePerSide < 0.995);
    if (interesting.length === 0) {
        console.log("      no level exceeds the reference — texel density is already well balanced across LODs.");
    } else {
        for (const p of interesting) {
            console.log(`      level ${p.level}: textures to ${(p.scalePerSide * 100).toFixed(0)}% per side ` +
                `→ save ${fmtMB(p.savedTexGpu)} MB`);
        }
        console.log(`      => texture GPU ${fmtMB(r.totals.texGpu)} → ${fmtMB(proj.after)} MB ` +
            `(save ${fmtMB(proj.saved)} MB, ${pct(proj.saved, r.totals.texGpu)}% of textures)`);
    }

    // Lever B — global downscale: shrink ALL textures uniformly (lowers the
    // delivered quality, but is the linear knob the team controls via -T / image size).
    console.log(`  [B] Global downscale of every texture (texel GPU scales with area):`);
    for (const side of [0.75, 0.5]) {
        const after = r.totals.texGpu * side * side;
        console.log(`      ${(side * 100).toFixed(0)}% per side → texture GPU ${fmtMB(after)} MB ` +
            `(save ${fmtMB(r.totals.texGpu - after)} MB, ${pct(r.totals.texGpu - after, r.totals.gpuTotal)}% of total GPU)`);
    }

    // Lever C — GPU texture compression, for JPEG/PNG-textured models.
    const isCompressed = !!(r.formats.ktx2 || r.formats.ktx1);
    if (!isCompressed) {
        const after = r.totals.texGpu * (opts.bptCompressed / 4);
        console.log(`  [C] KTX2/Basis (BC7/ASTC ~${opts.bptCompressed} B/texel vs 4 for RGBA8):`);
        console.log(`      texture GPU ${fmtMB(r.totals.texGpu)} → ${fmtMB(after)} MB ` +
            `(save ${fmtMB(r.totals.texGpu - after)} MB, ${pct(r.totals.texGpu - after, r.totals.gpuTotal)}% of total GPU)`);
    } else {
        console.log(`  [C] Already GPU-compressed (KTX2) at ${opts.bptCompressed} B/texel.`);
    }
}

function printCrossSummary(reports, opts) {
    console.log("\n" + "=".repeat(92));
    console.log("CROSS-MODEL SUMMARY  (savings as % of that model's texture GPU)");
    console.log("-".repeat(92));
    console.log("  " + pad("model", 26) + padL("texGPU", 9) + padL("tex%", 6) +
        padL("texel/tri", 10) + padL("[A]cap", 8) + padL("[B]½side", 9) + padL("[C]ktx2", 9));
    let totTex = 0, totCap = 0;
    for (const r of reports) {
        const proj = projectDensityCap(r.levels);
        const dens = r.totals.triangles ? r.totals.texPixels / r.totals.triangles : 0;
        const half = r.totals.texGpu * 0.75; // 50% per side saves 75%
        const ktx = r.formats.ktx2 || r.formats.ktx1 ? 0 : r.totals.texGpu * (1 - opts.bptCompressed / 4);
        totTex += r.totals.texGpu; totCap += proj.saved;
        console.log("  " + pad(r.name.slice(0, 25), 26) + padL(fmtMB(r.totals.texGpu), 9) +
            padL(pct(r.totals.texGpu, r.totals.gpuTotal) + "%", 6) +
            padL(dens.toFixed(0), 10) +
            padL(pct(proj.saved, r.totals.texGpu) + "%", 8) +
            padL(pct(half, r.totals.texGpu) + "%", 9) +
            padL((r.formats.ktx2 ? "—" : pct(ktx, r.totals.texGpu) + "%"), 9));
    }
    console.log("-".repeat(92));
    console.log(`  TOTAL texture GPU across listed models: ${fmtMB(totTex)} MB`);
    console.log(`  [A] density cap (lossless vs each model's reference LOD): ${fmtMB(totCap)} MB (${pct(totCap, totTex)}%)`);
    console.log(`  [B] 50%/side downscale: ${fmtMB(totTex * 0.75)} MB (75%) — but lowers delivered quality`);
    console.log(`  [C] KTX2 at ${opts.bptCompressed} B/texel: ~${pct(1 - opts.bptCompressed / 4, 1)}% off any JPEG-textured model`);
}

main();
