"use strict";
/**
 * Detect image format and pixel dimensions from the first bytes of a texture
 * blob. Nexus stores per-node textures as embedded JPEG (the common case) or,
 * in experimental KTX builds, KTX1/KTX2 containers. We only need width/height
 * to reason about texel budgets, so we parse just the relevant marker/header.
 */

function imageInfo(buf) {
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
        return jpeg(buf);
    }
    if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
        return png(buf);
    }
    if (isKtx2(buf)) return ktx2(buf);
    if (isKtx1(buf)) return ktx1(buf);
    return { format: "unknown", width: 0, height: 0 };
}

function jpeg(buf) {
    // Walk the marker segments until a Start-Of-Frame (SOFn) carries the dims.
    let o = 2;
    const len = buf.length;
    while (o + 9 < len) {
        if (buf[o] !== 0xff) { o++; continue; }
        let marker = buf[o + 1];
        // skip fill bytes / standalone markers
        while (marker === 0xff && o + 1 < len) { o++; marker = buf[o + 1]; }
        o += 2;
        // SOF0..SOF15 except DHT(c4) DAC(cc) and RSTn — these hold frame dims
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            if (o + 7 > len) break;
            const height = buf.readUInt16BE(o + 3);
            const width = buf.readUInt16BE(o + 5);
            return { format: "jpeg", width, height };
        }
        if (o + 2 > len) break;
        const segLen = buf.readUInt16BE(o);
        if (segLen < 2) break;
        o += segLen;
    }
    return { format: "jpeg", width: 0, height: 0 };
}

function png(buf) {
    // IHDR is the first chunk: 8-byte sig, 4 len, "IHDR", then width/height u32
    return { format: "png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const KTX2_ID = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
const KTX1_ID = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);

function isKtx2(buf) { return buf.length >= 24 && buf.subarray(0, 12).equals(KTX2_ID); }
function isKtx1(buf) { return buf.length >= 36 && buf.subarray(0, 12).equals(KTX1_ID); }

function ktx2(buf) {
    // KTX2 header: 12 id, u32 vkFormat, u32 typeSize, u32 width, u32 height, ...
    return { format: "ktx2", width: buf.readUInt32LE(20), height: buf.readUInt32LE(24) };
}

function ktx1(buf) {
    // KTX1 header: 12 id, u32 endianness, then 12 u32 fields; width @ 36, height @ 40
    return { format: "ktx1", width: buf.readUInt32LE(36), height: buf.readUInt32LE(40) };
}

module.exports = { imageInfo };
