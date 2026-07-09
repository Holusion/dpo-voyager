"use strict";
/**
 * Minimal, dependency-free parser for the Nexus (.nxs / .nxz) multiresolution
 * mesh format. Reads only the header + index (88 bytes + node/patch/texture
 * tables), so it is O(index size) regardless of how large the model is — it
 * never reads the geometry/texture payload unless you ask for a texture blob.
 *
 * Ported from the layout in `assets/js/nexus/nexus.js` (importHeader /
 * handleIndex). Field sizes:
 *   header     88 bytes  (magic, version, V/F counts, signature, table counts, sphere)
 *   node       44 bytes  (offset, nvert, nface, error, cone[8], sphere[5], firstpatch)
 *   patch      12 bytes  (node, lastTriangle, texture)
 *   texture    68 bytes  (offset, proj-matrix[16])
 * All on-disk offsets are stored divided by PADDING (256) and must be multiplied.
 */

const fs = require("fs");

const MAGIC = 0x4e787320;
const PADDING = 256;
const HEADER_SIZE = 88;
const NODE_SIZE = 44;
const PATCH_SIZE = 12;
const TEXTURE_SIZE = 68;

// signature flag bits
const FLAG_MECO = 2;
const FLAG_CORTO = 4;
const FLAG_DEEPZOOM = 8;

function parseHeader(buf) {
    let o = 0;
    const magic = buf.readUInt32LE(o); o += 4;
    if (magic !== MAGIC) {
        throw new Error(`not a nexus file (magic ${magic.toString(16)})`);
    }
    const version = buf.readUInt32LE(o); o += 4;
    const verticesCount = Number(buf.readBigUInt64LE(o)); o += 8;
    const facesCount = Number(buf.readBigUInt64LE(o)); o += 8;

    // signature: vertex element (8 attrs x 2 bytes), face element (8 x 2), flags (4)
    const vertex = parseElement(buf, o); o += 16;
    const face = parseElement(buf, o); o += 16;
    const flags = buf.readUInt32LE(o); o += 4;

    const nodesCount = buf.readUInt32LE(o); o += 4;
    const patchesCount = buf.readUInt32LE(o); o += 4;
    const texturesCount = buf.readUInt32LE(o); o += 4;
    const sphere = {
        center: [buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8)],
        radius: buf.readFloatLE(o + 12),
    };
    o += 16;

    // per-vertex byte size on the GPU (matches nexus.js t.vsize / t.fsize)
    const vsize = 12 + (vertex.normal ? 6 : 0) + (vertex.color ? 4 : 0) + (vertex.texCoord ? 8 : 0);
    const fsize = 6;

    return {
        version, verticesCount, facesCount,
        vertex, face, flags,
        nodesCount, patchesCount, texturesCount,
        sphere, vsize, fsize,
        compressed: !!(flags & (FLAG_MECO | FLAG_CORTO)),
        meco: !!(flags & FLAG_MECO),
        corto: !!(flags & FLAG_CORTO),
        deepzoom: !!(flags & FLAG_DEEPZOOM),
    };
}

// One "element" is 8 attributes; each attribute is (type:u8, size:u8).
// We only need to know which channels are present (size != 0).
function parseElement(buf, o) {
    const attr = (i) => {
        const size = buf.readUInt8(o + i * 2 + 1);
        return size === 0 ? null : { type: buf.readUInt8(o + i * 2), size };
    };
    return {
        position: attr(0),
        normal: attr(1),
        color: attr(2),
        texCoord: attr(3),
        data: attr(4),
    };
}

/**
 * Parse a .nxs/.nxz file. Returns the header plus node/patch/texture tables.
 * Each node gets: nvert, nface, error, sphere radius, geomBytes, level,
 * patch list and the set of textures it references (with byte sizes).
 */
function parseNexus(filePath) {
    const fd = fs.openSync(filePath, "r");
    try {
        const head = Buffer.alloc(HEADER_SIZE);
        fs.readSync(fd, head, 0, HEADER_SIZE, 0);
        const h = parseHeader(head);

        const indexSize = h.nodesCount * NODE_SIZE + h.patchesCount * PATCH_SIZE + h.texturesCount * TEXTURE_SIZE;
        const idx = Buffer.alloc(indexSize);
        fs.readSync(fd, idx, 0, indexSize, HEADER_SIZE);

        // --- nodes ---
        const nodes = new Array(h.nodesCount);
        let o = 0;
        for (let i = 0; i < h.nodesCount; i++) {
            const offset = idx.readUInt32LE(o) * PADDING; o += 4;
            const nvert = idx.readUInt16LE(o); o += 2;
            const nface = idx.readUInt16LE(o); o += 2;
            const error = idx.readFloatLE(o); o += 4;
            o += 8; // skip cone
            const sphereRadius = idx.readFloatLE(o + 12); // 4th float of 5 (center xyz, r, tightR)
            o += 20;
            const firstpatch = idx.readUInt32LE(o); o += 4;
            nodes[i] = {
                id: i, offset, nvert, nface, error, sphereRadius, firstpatch,
                geomBytes: h.vsize * nvert + h.fsize * nface,
                patches: [], textures: new Set(), level: -1,
            };
        }

        // --- patches --- (node, lastTriangle, texture) x patchesCount
        const patchBase = o;
        const patches = new Array(h.patchesCount);
        for (let i = 0; i < h.patchesCount; i++) {
            const p = patchBase + i * PATCH_SIZE;
            patches[i] = {
                node: idx.readUInt32LE(p),         // destination (child) node
                lastTriangle: idx.readUInt32LE(p + 4),
                texture: idx.readUInt32LE(p + 8),
            };
        }
        o = patchBase + h.patchesCount * PATCH_SIZE;

        // --- texture offset table --- texturesCount entries; entry[i+1]-entry[i] = size of texture i
        const texOffsets = new Array(h.texturesCount);
        for (let i = 0; i < h.texturesCount; i++) {
            texOffsets[i] = idx.readUInt32LE(o) * PADDING;
            o += TEXTURE_SIZE;
        }
        // texture i spans [texOffsets[i], texOffsets[i+1]); last entry is the end sentinel
        const textures = [];
        for (let i = 0; i < h.texturesCount - 1; i++) {
            textures.push({ id: i, offset: texOffsets[i], bytes: texOffsets[i + 1] - texOffsets[i] });
        }

        // attach patches/textures to their parent node (node i owns patches
        // [firstpatch[i], firstpatch[i+1]) ); follow nexus.js convention.
        for (let i = 0; i < h.nodesCount - 1; i++) {
            const start = nodes[i].firstpatch;
            const end = nodes[i + 1].firstpatch;
            for (let p = start; p < end; p++) {
                nodes[i].patches.push(patches[p]);
                const tex = patches[p].texture;
                if (tex < textures.length) nodes[i].textures.add(tex);
            }
        }

        // --- LOD levels via BFS over the DAG (patch.node = child) from root 0 ---
        assignLevels(nodes);

        return { file: filePath, header: h, nodes, patches, textures, texOffsets };
    } finally {
        fs.closeSync(fd);
    }
}

// Node 0 is the coarsest (root). A node's patches point to finer child nodes.
// level = shortest-path depth from the root; coarsest = 0.
function assignLevels(nodes) {
    if (nodes.length === 0) return;
    nodes[0].level = 0;
    const queue = [0];
    while (queue.length) {
        const id = queue.shift();
        const lvl = nodes[id].level;
        for (const patch of nodes[id].patches) {
            const child = patch.node;
            if (child < nodes.length && nodes[child].level === -1) {
                nodes[child].level = lvl + 1;
                queue.push(child);
            }
        }
    }
    // sink node (last) has no geometry of its own; leave any unreached at maxLevel+1
    const maxLevel = nodes.reduce((m, n) => Math.max(m, n.level), 0);
    for (const n of nodes) if (n.level === -1) n.level = maxLevel;
}

/** Read the raw bytes of texture `id` from disk. */
function readTexture(filePath, texture) {
    const fd = fs.openSync(filePath, "r");
    try {
        const buf = Buffer.alloc(texture.bytes);
        fs.readSync(fd, buf, 0, texture.bytes, texture.offset);
        return buf;
    } finally {
        fs.closeSync(fd);
    }
}

/** Open a shared fd and return a reader closure (avoids reopening per texture). */
function openTextureReader(filePath) {
    const fd = fs.openSync(filePath, "r");
    const read = (texture, maxBytes) => {
        const n = maxBytes ? Math.min(maxBytes, texture.bytes) : texture.bytes;
        const buf = Buffer.alloc(n);
        fs.readSync(fd, buf, 0, n, texture.offset);
        return buf;
    };
    read.close = () => fs.closeSync(fd);
    return read;
}

module.exports = { parseNexus, readTexture, openTextureReader, PADDING };
