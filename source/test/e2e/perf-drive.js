const { chromium } = require("playwright");

const SCENE = process.argv[2] || "Mausolée_Seclin";
const URL = `http://localhost:8099/voyager-story-dev.html?root=${encodeURIComponent("/files/" + SCENE)}/&document=scene.svx.json&mode=edit`;

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    console.log("scene:", SCENE);
    await page.goto(URL, { waitUntil: "load" });

    await page.waitForFunction(() => {
        const ss = window.voyagerStory && window.voyagerStory.system.components.get("CVSaveState");
        return !!(ss && ss.isTracking);
    }, null, { timeout: 240000 });
    console.log("armed");

    await page.evaluate(() => {
        const sys = window.voyagerStory.system;
        const ss = sys.components.get("CVSaveState");
        const doc = () => sys.components.get("CVDocumentProvider").activeComponent;
        window.__p = {
            ss,
            find(t, path) {
                const d = doc();
                for (const c of d.innerGraph.components.getArray().concat([d])) {
                    if (c.constructor.typeName !== t) continue;
                    for (const p of c.ins.properties) if (p.path === path) return p;
                }
                return null;
            },
            // Writes a property once per animation frame, the way a slider drag
            // does, and returns how many frames it actually took.
            drag(t, path, from, to, frames) {
                const p = window.__p.find(t, path);
                if (!p) return Promise.resolve({ error: "not found" });
                return new Promise(resolve => {
                    let i = 0;
                    const t0 = performance.now();
                    const step = () => {
                        const k = i / (frames - 1);
                        if (Array.isArray(p.value)) {
                            for (let j = 0; j < p.value.length; ++j) {
                                p.value[j] = from[j] + (to[j] - from[j]) * k;
                            }
                        }
                        else {
                            p.value = from + (to - from) * k;
                        }
                        p.set();
                        if (++i < frames) requestAnimationFrame(step);
                        else resolve({ frames: i, elapsedMs: performance.now() - t0 });
                    };
                    requestAnimationFrame(step);
                });
            },
            // Cost of one performance.now(), so the instrumentation's own
            // overhead can be taken back out of the numbers.
            calibrate() {
                const n = 200000;
                const t0 = performance.now();
                let sink = 0;
                for (let i = 0; i < n; ++i) sink += performance.now();
                const t1 = performance.now();
                return { nowMs: (t1 - t0) / n, sink: sink > 0 };
            },
            // Median frame interval while a phase runs, to say what share of a
            // frame the feature takes.
            frameTimes(ms) {
                return new Promise(resolve => {
                    const deltas = [];
                    let last = performance.now();
                    const end = last + ms;
                    const step = () => {
                        const now = performance.now();
                        deltas.push(now - last);
                        last = now;
                        if (now < end) requestAnimationFrame(step);
                        else {
                            deltas.sort((a, b) => a - b);
                            resolve({ frames: deltas.length, medianMs: deltas[deltas.length >> 1] });
                        }
                    };
                    requestAnimationFrame(step);
                });
            },
            report(label) {
                const r = window.__p.ss.metrics.report();
                return { label, text: window.__p.ss.metrics.format(), report: r };
            },
            reset() { window.__p.ss.metrics.reset(); },
        };
    });

    const phase = async (label, body) => {
        await page.evaluate(() => window.__p.reset());
        await body();
        const out = await page.evaluate(l => window.__p.report(l), label);
        console.log(`\n### ${label}\n${out.text}`);
        return out.report;
    };

    // The dev build logs every edit, and a console.log with a debugger
    // attached costs about as much as the work being measured. Silence it: a
    // production build has no such call at all.
    await page.evaluate(() => { window.__log = console.log; console.log = () => {}; });

    const calib = await page.evaluate(() => window.__p.calibrate());
    console.log(`performance.now() costs ${(calib.nowMs * 1000).toFixed(3)} us per call`);


    const idle = await phase("A. armed and idle, 15 s", () => page.waitForTimeout(15000));

    let dragTiming = null;
    const drag = await phase("B. slider drag, 60 frames on Floor.Opacity", async () => {
        dragTiming = await page.evaluate(() => window.__p.drag("CVFloor", "Floor.Opacity", 0.9, 0.2, 60));
        await page.waitForTimeout(1000);
    });
    console.log(`  drag ran ${dragTiming.frames} frames in ${dragTiming.elapsedMs.toFixed(0)} ms `
        + `(${(dragTiming.elapsedMs / dragTiming.frames).toFixed(1)} ms/frame)`);

    let moveTiming = null;
    const move = await phase("C. gizmo drag, 60 frames on Model.Position (cascades)", async () => {
        moveTiming = await page.evaluate(() => window.__p.drag("CVModel2", "Model.Position", [0, 0, 0], [0, 0.5, 0], 60));
        await page.waitForTimeout(1000);
    });
    console.log(`  drag ran ${moveTiming.frames} frames in ${moveTiming.elapsedMs.toFixed(0)} ms `
        + `(${(moveTiming.elapsedMs / moveTiming.frames).toFixed(1)} ms/frame)`);

    const undo = await phase("D. one undo, then settle", async () => {
        await page.evaluate(() => window.__p.ss.undo());
        await page.waitForTimeout(2000);
    });

    console.log("\n### machine-readable");
    console.log(JSON.stringify({ calib, dragTiming, moveTiming, idle, drag, move, undo }, null, 1));

    // Two timestamps per scan, plus one per suspend and per defer, are the
    // instrumentation's own cost; take them back out.
    const corrected = (label, r, frameMs) => {
        const overhead = calib.nowMs * (2 * r.scans + 2 * r.suspends + 2 * r.defers);
        const own = r.scanTimeMs + r.flushTimeMs + r.deferTimeMs;
        console.log(`${label.padEnd(12)} measured ${own.toFixed(2)} ms, timing overhead ~${overhead.toFixed(2)} ms, `
            + `net ${(own - overhead).toFixed(2)} ms over ${r.frames} ticks `
            + `= ${((own - overhead) / r.frames).toFixed(3)} ms/tick `
            + (frameMs ? `(${(100 * (own - overhead) / r.frames / frameMs).toFixed(1)}% of a ${frameMs.toFixed(1)} ms frame)` : ""));
    };
    await page.evaluate(() => { console.log = window.__log; });
    console.log("\n### net of instrumentation");
    corrected("idle", idle);
    corrected("slider", drag, dragTiming.elapsedMs / dragTiming.frames);
    corrected("gizmo", move, moveTiming.elapsedMs / moveTiming.frames);
    corrected("undo", undo);

    await browser.close();
})();
