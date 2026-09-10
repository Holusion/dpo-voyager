const { chromium } = require("playwright");

const SCENE = process.argv[2] || "Mausolée_Seclin";
const URL = `http://localhost:8099/voyager-story-dev.html?root=/files/${encodeURIComponent(SCENE)}/&document=scene.svx.json&mode=edit`;

const results = [];
function report(name, ok, detail) {
    results.push({ name, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(30)}${detail ? "  " + detail : ""}`);
}

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const pageErrors = [];
    page.on("pageerror", e => pageErrors.push(String(e)));

    console.log(`scene: ${SCENE}`);
    const t0 = Date.now();
    await page.goto(URL, { waitUntil: "load" });

    const armed = await page.waitForFunction(() => {
        const sys = window.voyagerStory && window.voyagerStory.system;
        const ss = sys && sys.components.get("CVSaveState");
        return !!(ss && ss.isTracking);
    }, null, { timeout: 240000 }).then(() => true).catch(() => false);

    report(`arms after load (${((Date.now() - t0) / 1000).toFixed(1)}s)`, armed);
    if (!armed) { await browser.close(); process.exit(1); }

    await page.evaluate(() => {
        const sys = window.voyagerStory.system;
        const ss = sys.components.get("CVSaveState");
        const doc = () => sys.components.get("CVDocumentProvider").activeComponent;
        const tracked = p => !p.schema.event && p.type !== "object";
        window.__probe = {
            ss,
            comps() { const d = doc(); return d.innerGraph.components.getArray().concat([d]); },
            snapshot() {
                const out = {};
                for (const c of window.__probe.comps())
                    for (const p of c.ins.properties) {
                        if (!tracked(p)) continue;
                        out[c.id + "|" + c.constructor.typeName + "." + p.path] = JSON.stringify(p.value);
                    }
                return out;
            },
            find(t, path) {
                for (const c of window.__probe.comps()) {
                    if (c.constructor.typeName !== t) continue;
                    for (const p of c.ins.properties) if (p.path === path) return p;
                }
                return null;
            },
            write(t, path, v) {
                const p = window.__probe.find(t, path);
                if (!p) return false;
                if (Array.isArray(p.value) && Array.isArray(v)) { for (let i = 0; i < v.length; ++i) p.value[i] = v[i]; }
                else p.value = v;
                p.set();
                return true;
            },
            read(t, path) { const p = window.__probe.find(t, path); return p ? JSON.stringify(p.value) : null; },
            state: () => ({
                dirty: ss.outs.dirty.value, canUndo: ss.outs.canUndo.value, canRedo: ss.outs.canRedo.value,
                unjournaled: ss.hasUnjournaledEdits, entries: ss.journal.log.length, position: ss.journal.position,
            }),
            names: () => ss.journal.log.map(e => e.name),
            titles: () => ss.journal.log.map(e => e.title),
            undoTitle: () => ss.journal.undoTitle,
            redoTitle: () => ss.journal.redoTitle,
            reset() { ss.commitEdit(); ss.journal.clear(); ss.markSaved(); },
        };
    });

    const ev = (fn, ...a) => page.evaluate(fn, ...a);
    const settle = () => page.waitForTimeout(250);

    // Camera pose and the transforms navigation drives are view state, not
    // document state: the journal deliberately does not take them back (an open
    // design question - see the handover, section 8). Kept out of the oracle so
    // it reports what undo is meant to cover.
    const viewState = k => /CVOrbitNavigation\.Current\.|CVOrbitNavigation\.Camera\.ViewPreset|CVCamera\.Frustum\.|CVNode\.Transform\.|CVReader\.Reader\.Focus/.test(k);
    const diff = (a, b) => {
        const d = [];
        for (const k of Object.keys(a)) if (!viewState(k) && b[k] !== a[k]) d.push(`${k}: ${a[k]} -> ${b[k]}`);
        for (const k of Object.keys(b)) if (!viewState(k) && !(k in a)) d.push(`${k}: appeared`);
        return d;
    };

    // ------------------------------------------------- quiet after load (T1/T4)
    {
        const seen = [];
        for (let i = 0; i < 15; ++i) {
            await page.waitForTimeout(1000);
            const n = await ev(() => window.__probe.names());
            for (let k = seen.length; k < n.length; ++k) console.log(`   +${i + 1}s: ${n[k]}`);
            seen.length = 0; seen.push(...n);
        }
        const st = await ev(() => window.__probe.state());
        report("quiet for 15s after arming", seen.length === 0 && !st.dirty,
            seen.length ? `${seen.length} entries` : st.dirty ? `dirty (unjournaled=${st.unjournaled})` : "");
    }

    // --------------------------------------------------------------- scenarios
    const scenarios = [
        ["document title",       "CVDocument",         "Document.Title",          "Undo Test Title"],
        ["document intro",       "CVDocument",         "Document.Intro",          "an intro"],
        ["background colour",    "CVBackground",       "Background.Color0",       [1, 0, 0]],
        ["background style",     "CVBackground",       "Background.Style",        1],
        ["grid visibility",      "CVGrid",             "Object.Visible",          true],
        ["grid colour",          "CVGrid",             "Grid.Color",              [0.2, 0.3, 0.9]],
        ["floor colour",         "CVFloor",            "Floor.Color",             [0.1, 0.9, 0.2]],
        ["floor opacity",        "CVFloor",            "Floor.Opacity",           0.25],
        ["reader enabled",       "CVReader",           "Reader.Enabled",          true],
        ["tape visible",         "CVTape",             "Object.Visible",          true],
        ["tape enabled",         "CVTape",             "Tape.Enabled",            true],
        ["slicer enabled",       "CVSlicer",           "Slice.Enabled",           true],
        ["slicer axis",          "CVSlicer",           "Slice.Axis",              2],
        ["viewer shader",        "CVViewer",           "Renderer.Shader",         1],
        ["viewer exposure",      "CVViewer",           "Renderer.Exposure",       1.4],
        ["viewer quality",       "CVViewer",           "Models.Quality",          2],
        ["annotations visible",  "CVViewer",           "Annotations.Visible",     true],
        ["nav auto rotation",    "CVOrbitNavigation",  "Navigation.AutoRotation", true],
        ["nav lights follow",    "CVOrbitNavigation",  "Navigation.LightsFollowCam", false],
        ["scene units",          "CVScene",            "Scene.Units",             3],
        ["model position",       "CVModel2",           "Model.Position",          [1.5, 0.25, -3]],
        ["model rotation",       "CVModel2",           "Model.Rotation",          [10, 20, 30]],
        ["model base colour",    "CVModel2",           "Material.BaseColor",      [0.2, 0.4, 0.6]],
        ["model roughness",      "CVModel2",           "Material.Roughness",      0.33],
        ["model shadow side",    "CVModel2",           "Model.ShadowSide",        0],
        ["light colour",         "CVDirectionalLight", "Light.Color",             [0.9, 0.4, 0.1]],
        ["light intensity",      "CVDirectionalLight", "Light.Intensity",         0.42],
        ["light shadow blur",    "CVDirectionalLight", "Shadow.Blur",             0.5],
        ["environment map",      "CVEnvironment",      "Environment.MapIndex",    2],
        ["camera projection",    "CVOrbitNavigation",  "Camera.Projection",       1],
        ["interface visible",    "CVInterface",        "Interface.Visible",       false],
    ];

    for (const [name, type, path, initial] of scenarios) {
        let value = initial;
        await ev(() => window.__probe.reset());
        await settle();

        const base = await ev(([t, p]) => window.__probe.read(t, p), [type, path]);
        if (base === null) { report(name, false, "property not in this scene"); continue; }
        // Earlier scenarios leave the scene where they put it, so a fixed
        // target value is sometimes already in place. Flip booleans; for
        // anything else say so rather than testing nothing.
        if (base === JSON.stringify(value)) {
            if (typeof value === "boolean") { value = !value; }
            else { report(name, false, `already ${base}; pick another value`); continue; }
        }

        const baseSnap = await ev(() => window.__probe.snapshot());
        await ev(([t, p, v]) => window.__probe.write(t, p, v), [type, path, value]);
        await settle();

        // What the undo button would say it is about to do.
        const title = await ev(() => window.__probe.undoTitle());

        const edited = await ev(([t, p]) => ({ v: window.__probe.read(t, p), ...window.__probe.state() }), [type, path]);
        if (edited.v === base)   { report(name, false, "value did not change"); continue; }
        if (!edited.dirty)       { report(name, false, "not marked dirty"); continue; }
        if (edited.unjournaled)  { report(name, false, "recorded as unjournaled"); continue; }

        let steps = 0;
        while ((await ev(() => window.__probe.state())).canUndo && steps < 12) {
            await ev(() => window.__probe.ss.undo());
            steps++;
            await settle();
            if (!(await ev(() => window.__probe.state())).dirty) break;
        }

        const undone = await ev(([t, p]) => ({ v: window.__probe.read(t, p), ...window.__probe.state() }), [type, path]);
        const snapDiff = diff(baseSnap, await ev(() => window.__probe.snapshot()));

        const note = `${edited.entries} entr${edited.entries === 1 ? "y" : "ies"}, ${steps} undo${steps === 1 ? "" : "s"}`
            + (title ? `  -  "${title}"` : "  -  NO TITLE");
        if (undone.v !== base)  { report(name, false, `undo left ${undone.v}, want ${base} (${note})`); continue; }
        if (undone.dirty)       { report(name, false, `still dirty (${note})`); continue; }
        if (snapDiff.length)    { report(name, false, `${snapDiff.length} other properties not restored (${note}):\n     ` + snapDiff.slice(0, 6).join("\n     ")); continue; }

        // and forward again
        let r = 0;
        while ((await ev(() => window.__probe.state())).canRedo && r < 12) { await ev(() => window.__probe.ss.redo()); r++; await settle(); }
        const redone = await ev(([t, p]) => ({ v: window.__probe.read(t, p), ...window.__probe.state() }), [type, path]);

        if (redone.v !== edited.v) { report(name, false, `redo left ${redone.v} (${note})`); continue; }
        if (!redone.dirty)         { report(name, false, `redo did not restore dirty (${note})`); continue; }
        report(name, true, note);
    }

    // -------------------------------------------------------- multi-edit oracle
    {
        await ev(() => window.__probe.reset());
        await settle();
        const base = await ev(() => window.__probe.snapshot());
        const edits = [
            ["CVDocument", "Document.Title", "Sequence"],
            ["CVBackground", "Background.Color0", [0.3, 0.4, 0.5]],
            ["CVGrid", "Object.Visible", true],
            ["CVModel2", "Model.Position", [2, 2, 2]],
            ["CVViewer", "Renderer.Shader", 2],
            ["CVBackground", "Background.Color0", [0.9, 0.1, 0.1]],
            ["CVModel2", "Model.Position", [-1, 0, 4]],
            ["CVFloor", "Floor.Opacity", 0.9],
            ["CVDirectionalLight", "Light.Intensity", 1.7],
            ["CVDocument", "Document.Title", "Sequence again"],
            ["CVSlicer", "Slice.Enabled", true],
            ["CVTape", "Tape.Enabled", true],
        ];
        for (const [t, p, v] of edits) {
            await ev(([t, p, v]) => window.__probe.write(t, p, v), [t, p, v]);
            await settle();
            await ev(() => window.__probe.ss.commitEdit());
        }
        const mid = await ev(() => window.__probe.state());
        const edited = await ev(() => window.__probe.snapshot());
        report(`${edits.length} edits in sequence`, mid.dirty && !mid.unjournaled, `${mid.entries} entries`);

        let g = 0;
        while ((await ev(() => window.__probe.state())).canUndo && g++ < 60) { await ev(() => window.__probe.ss.undo()); await settle(); }
        const d1 = diff(base, await ev(() => window.__probe.snapshot()));
        report("undo all restores every property", d1.length === 0,
            d1.length ? `${d1.length} differ:\n     ` + d1.slice(0, 10).join("\n     ") : `${g} undos`);
        report("clean at the save point", !(await ev(() => window.__probe.state())).dirty);

        let r = 0;
        while ((await ev(() => window.__probe.state())).canRedo && r++ < 60) { await ev(() => window.__probe.ss.redo()); await settle(); }
        const d2 = diff(edited, await ev(() => window.__probe.snapshot()));
        report("redo all restores the edited state", d2.length === 0,
            d2.length ? `${d2.length} differ:\n     ` + d2.slice(0, 10).join("\n     ") : `${r} redos`);
    }

    // ------------------------------------------------------------ non-edit noise
    {
        // A view preset moves the camera and writes itself back to None; the
        // journal treats the whole of view state as out of scope.
        await ev(() => window.__probe.reset());
        await settle();
        await ev(() => window.__probe.write("CVOrbitNavigation", "Camera.ViewPreset", 1));
        await page.waitForTimeout(1200);
        const vp = await ev(() => window.__probe.state());
        report("a view preset is not an edit", !vp.dirty && vp.entries === 0,
            vp.dirty || vp.entries ? `dirty=${vp.dirty} entries=${vp.entries}` : "");
    }
    {
        // Properties whose schema says transient: runtime state that no save
        // writes. Changing one must leave the document clean.
        const runtime = [
            ["CVReader", "Reader.Visible", false],
            ["CVReader", "Article.ID", "not-an-article"],
            ["CVTours", "Tours.Enabled", true],
            ["CVViewer", "Annotations.ActiveId", "nothing"],
            ["CVAudioManager", "Audio.CaptionsEnabled", false],
            ["CVOrbitNavigation", "Settings.PointerEnabled", false],
            ["CVOrbitNavigation", "Settings.PromptEnabled", false],
            ["CVLanguageManager", "Language.Enabled", true],
            ["CVInterface", "Interface.VisibleElements", 63],
        ];
        const dirtied = [];
        for (const [t, path, v] of runtime) {
            await ev(() => window.__probe.reset());
            await settle();
            const was = await ev(([t, p]) => window.__probe.read(t, p), [t, path]);
            const ok = await ev(([t, p, v]) => window.__probe.write(t, p, v), [t, path, v]);
            if (!ok) continue;
            await settle();
            const st = await ev(() => window.__probe.state());
            if (st.dirty || st.entries) {
                const names = await ev(() => window.__probe.names());
                dirtied.push(`${t}.${path} -> ${names.join(", ") || "no entry, unjournaled=" + st.unjournaled}`);
            }
            // Put it back: starting a tour or opening an article leaves the
            // viewer somewhere else, and the next case would inherit it.
            if (was !== null) {
                await ev(([t, p, v]) => window.__probe.write(t, p, v), [t, path, JSON.parse(was)]);
                await settle();
            }
        }
        report("runtime state is not an edit", dirtied.length === 0,
            dirtied.length ? `${dirtied.length} dirtied:\n     ` + dirtied.join("\n     ") : `${runtime.length} properties`);
    }

    {
        // Known gap, and the same one as the view preset: starting a tour
        // applies a snapshot, and a snapshot writes properties a save does
        // record - the camera pose among them. The transient flag cannot help
        // here; the question is whether playback should be journalled at all.
        await ev(() => window.__probe.reset());
        await settle();
        const played = await ev(() => window.__probe.write("CVTours", "Tours.Index", 0));
        await page.waitForTimeout(1500);
        const st = await ev(() => window.__probe.state());
        if (played) {
            report("playing a tour is not an edit", !st.dirty && st.entries === 0,
                st.dirty || st.entries ? (await ev(() => window.__probe.names())).join(", ") : "");
        }
        await ev(() => window.__probe.write("CVTours", "Tours.Index", -1));
        await settle();
    }

    {
        await ev(() => window.__probe.reset());
        await page.waitForTimeout(500);
        const box = await page.locator("canvas").first().boundingBox();
        if (box) {
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down();
            for (let i = 0; i < 15; ++i) {
                await page.mouse.move(box.x + box.width / 2 + i * 9, box.y + box.height / 2 + i * 5);
                await page.waitForTimeout(25);
            }
            await page.mouse.up();
            await page.mouse.wheel(0, -400);
        }
        await page.waitForTimeout(1500);
        const s = await ev(() => window.__probe.state());
        report("orbit + zoom is not an edit", !s.dirty && s.entries === 0,
            s.dirty || s.entries ? `dirty=${s.dirty} unjournaled=${s.unjournaled} ${(await ev(() => window.__probe.names())).slice(0, 6).join(", ")}` : "");
    }
    {
        await ev(() => window.__probe.reset());
        const buttons = page.locator(".sv-task-bar ff-button");
        const n = await buttons.count();
        for (let i = 0; i < n; ++i) {
            const t = await buttons.nth(i).getAttribute("text");
            if (!t || ["Save", "Download", "Exit", "Undo", "Redo"].includes(t)) continue;
            await buttons.nth(i).click({ timeout: 5000 }).catch(() => {});
            await page.waitForTimeout(700);
        }
        await page.waitForTimeout(800);
        const s = await ev(() => window.__probe.state());
        report("switching every task is not an edit", !s.dirty && s.entries === 0,
            s.dirty || s.entries ? `dirty=${s.dirty} unjournaled=${s.unjournaled} ${(await ev(() => window.__probe.names())).slice(0, 8).join(", ")}` : "");
    }

    console.log("\npage errors:", pageErrors.length);
    pageErrors.slice(0, 5).forEach(e => console.log("  ", e.slice(0, 300)));
    const failed = results.filter(r => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    await browser.close();
    process.exit(failed ? 1 : 0);
})();
