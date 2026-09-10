// Does an undo settle on its own, with no blanket suppression window?
//
// CVSaveState used to ignore every change for a fixed number of frames after an
// undo, because replaying an entry cascades into components whose derived writes
// were not bracketed. That number was empirical. This probe removes the need to
// guess it: for each property it edits, undoes, and then watches the journal for
// a generous number of frames, reporting any entry that appears after the undo.
//
// A spurious entry here means some site in the cascade is writing a tracked
// property without saying the write is derived - which is a missing bracket (or
// a genuine design problem), not a reason to widen a window.
const { chromium } = require("playwright");

const SCENE = process.argv[2] || "Mausolée_Seclin";
const URL = `http://localhost:8099/voyager-story-dev.html?root=${encodeURIComponent("/files/" + SCENE)}/&document=scene.svx.json&mode=edit`;

// Properties whose undo drives the longest cascades: scene bounds, units,
// broadcast controls, and the tape/grid pair that the settle window named.
const CASES = [
    ["CVModel2",          "Model.Position",       [1.5, 0.25, -3]],
    ["CVModel2",          "Model.Rotation",       [10, 20, 30]],
    ["CVScene",           "Scene.Units",          3],
    ["CVGrid",            "Object.Visible",       true],
    ["CVGrid",            "Grid.LabelEnabled",    false],
    ["CVTape",            "Object.Visible",       true],
    ["CVTape",            "Tape.Enabled",         true],
    ["CVFloor",           "Floor.Opacity",        0.25],
    ["CVViewer",          "Renderer.Shader",      1],
    ["CVViewer",          "Models.Quality",       2],
    ["CVViewer",          "Annotations.Visible",  true],
    ["CVDirectionalLight","Light.Intensity",      0.42],
    ["CVEnvironment",     "Environment.MapIndex", 2],
    ["CVOrbitNavigation", "Navigation.LightsFollowCam", false],
    ["CVSlicer",          "Slice.Enabled",        true],
];

const WATCH_FRAMES = Number(process.env.WATCH_FRAMES) || 60;
const t0 = Date.now();
const since = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;
const log = s => { console.log(`${since()} ${s}`); };

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const pageErrors = [];
    page.on("pageerror", e => pageErrors.push(String(e)));

    log(`loading ${SCENE}`);
    await page.goto(URL, { waitUntil: "load" });
    log("page loaded, waiting for edit tracking to arm");
    await page.waitForFunction(() => {
        const ss = window.voyagerStory && window.voyagerStory.system.components.get("CVSaveState");
        return !!(ss && ss.isTracking);
    }, null, { timeout: 600000 });
    log("armed");

    await page.evaluate(() => {
        const sys = window.voyagerStory.system;
        const ss = sys.components.get("CVSaveState");
        const doc = () => sys.components.get("CVDocumentProvider").activeComponent;
        const comps = () => { const d = doc(); return d.innerGraph.components.getArray().concat([d]); };
        const find = (t, path) => {
            for (const c of comps()) {
                if (c.constructor.typeName !== t) continue;
                for (const p of c.ins.properties) if (p.path === path) return p;
            }
            return null;
        };
        window.__p = {
            ss, find,
            write(t, path, v) {
                const p = find(t, path);
                if (!p) return false;
                if (Array.isArray(p.value) && Array.isArray(v)) { for (let i = 0; i < v.length; ++i) p.value[i] = v[i]; }
                else p.value = v;
                p.set();
                return true;
            },
            read: (t, p) => { const q = find(t, p); return q ? JSON.stringify(q.value) : null; },
            names: () => ss.journal.log.map(e => e.name),
            frames(n) {
                return new Promise(resolve => {
                    let i = 0;
                    const step = () => (++i >= n ? resolve() : requestAnimationFrame(step));
                    requestAnimationFrame(step);
                });
            },
            reset() { ss.commitEdit(); ss.journal.clear(); ss.markSaved(); },
        };
    });

    let failures = 0;
    log(`watching ${WATCH_FRAMES} frames after each undo, ${CASES.length} cases\n`);

    for (const [type, path, target] of CASES) {
        log(`-> ${type}.${path}`);
        const out = await page.evaluate(async ([type, path, target, watchFrames]) => {
            const p = window.__p;
            p.reset();
            await p.frames(5);

            const base = p.read(type, path);
            if (base === null) return { missing: true };
            let value = target;
            if (base === JSON.stringify(value)) {
                if (typeof value === "boolean") value = !value;
                else return { alreadySet: base };
            }

            p.write(type, path, value);
            await p.frames(20);
            p.ss.commitEdit();
            const afterEdit = p.names();
            const editedValue = p.read(type, path);

            // The undo itself, then a long unattended watch. Nothing clears a
            // suppression window here - no pointer, no key - so anything the
            // cascade writes without a bracket will show up.
            p.ss.undo();

            const appeared = [];
            for (let i = 0; i < watchFrames; ++i) {
                await p.frames(1);
                const n = p.names();
                for (let k = afterEdit.length; k < n.length; ++k) {
                    if (!appeared.some(a => a.name === n[k])) appeared.push({ frame: i, name: n[k] });
                }
            }

            return {
                base, editedValue, undoneValue: p.read(type, path),
                afterEdit, appeared,
                dirty: p.ss.outs.dirty.value,
                canRedo: p.ss.outs.canRedo.value,
                unjournaled: p.ss.hasUnjournaledEdits,
            };
        }, [type, path, target, WATCH_FRAMES]);

        const label = `${type}.${path}`.padEnd(38);
        if (out.missing)    { console.log(`SKIP  ${label} not in this scene`); continue; }
        if (out.alreadySet) { console.log(`SKIP  ${label} already ${out.alreadySet}`); continue; }

        const restored = out.undoneValue === out.base;
        const clean = out.appeared.length === 0 && !out.dirty && !out.unjournaled;
        const ok = restored && clean && out.canRedo;
        if (!ok) ++failures;

        console.log(`${ok ? "PASS" : "FAIL"}  ${label} ${out.base} -> ${out.editedValue} -> ${out.undoneValue}`);
        if (!restored)  console.log(`        undo did not restore the value`);
        if (out.dirty)  console.log(`        still dirty after undo (unjournaled=${out.unjournaled})`);
        if (!out.canRedo) console.log(`        redo was lost`);
        if (out.appeared.length) {
            console.log(`        ${out.appeared.length} entr${out.appeared.length === 1 ? "y" : "ies"} appeared AFTER the undo:`);
            for (const a of out.appeared) console.log(`          +${a.frame} frame(s): ${a.name}`);
        }
    }

    console.log(`\npage errors: ${pageErrors.length}`);
    pageErrors.slice(0, 5).forEach(e => console.log("  ", e.slice(0, 200)));
    console.log(`${failures === 0 ? "all clean" : failures + " failing"}`);
    await browser.close();
    process.exit(failures ? 1 : 0);
})();
