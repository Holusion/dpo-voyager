// T6 - does editing an annotation mark the document unsaved?
//
// An annotation's title, body and position live on the Annotation object, not
// in graph properties, so the change observer cannot see them: before T6,
// retyping an annotation label and closing the tab lost it with no prompt.
//
// The last case is the one that constrains the fix. Moving a model drags its
// annotations along, and that must NOT report an annotation edit - the move is
// already journalled as Model.Position, so an unjournaled flag raised here
// would survive the undo and leave the document dirty with an empty undo stack.
const { chromium } = require("playwright");

const SCENE = process.argv[2] || "Mausolée_Seclin";
const URL = `http://localhost:8099/voyager-story-dev.html?root=${encodeURIComponent("/files/" + SCENE)}/&document=scene.svx.json&mode=edit`;

const results = [];
function report(name, ok, detail) {
    results.push({ name, ok });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(46)}${detail || ""}`);
}

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const pageErrors = [];
    page.on("pageerror", e => pageErrors.push(String(e)));

    await page.goto(URL, { waitUntil: "load" });
    await page.waitForFunction(() => {
        const ss = window.voyagerStory && window.voyagerStory.system.components.get("CVSaveState");
        return !!(ss && ss.isTracking);
    }, null, { timeout: 600000 });

    await page.evaluate(() => {
        const sys = window.voyagerStory.system;
        const ss = sys.components.get("CVSaveState");
        const doc = sys.components.get("CVDocumentProvider").activeComponent;
        const comps = doc.innerGraph.components.getArray().concat([doc]);
        window.__a = {
            ss, sys,
            views: () => comps.filter(c => c.constructor.typeName === "CVAnnotationView"),
            viewWithAnnotations() {
                for (const v of window.__a.views()) if (v.getAnnotations().length) return v;
                return null;
            },
            find(t, path) {
                for (const c of comps) {
                    if (c.constructor.typeName !== t) continue;
                    for (const p of c.ins.properties) if (p.path === path) return p;
                }
                return null;
            },
            write(t, path, v) {
                const p = window.__a.find(t, path);
                if (!p) return false;
                if (Array.isArray(p.value) && Array.isArray(v)) { for (let i = 0; i < v.length; ++i) p.value[i] = v[i]; }
                else p.value = v;
                p.set();
                return true;
            },
            state: () => ({
                dirty: ss.outs.dirty.value,
                unjournaled: ss.hasUnjournaledEdits,
                entries: ss.journal.log.length,
                canUndo: ss.outs.canUndo.value,
            }),
            reset() { ss.commitEdit(); ss.journal.clear(); ss.markSaved(); },
            wait: ms => new Promise(r => setTimeout(r, ms)),
        };
    });

    const has = await page.evaluate(() => !!window.__a.viewWithAnnotations());
    if (!has) { console.log(`no annotations in ${SCENE}; nothing to test`); await browser.close(); process.exit(0); }

    // ---- title goes through a graph property, so it is journalled and undoable.
    // Asserted here so that stays true: if it ever starts reporting unjournaled
    // instead, undo would silently stop being able to take a rename back.
    {
        const out = await page.evaluate(async () => {
            const a = window.__a;
            const view = a.viewWithAnnotations();
            view.activeAnnotation = view.getAnnotations()[0];
            await a.wait(300);
            a.reset(); await a.wait(400);

            const was = view.ins.title.value;
            view.ins.title.setValue("Probe edited title");
            await a.wait(500);
            const edited = a.state();

            let steps = 0;
            while (a.ss.outs.canUndo.value && steps < 6) {
                a.ss.undo(); ++steps; await a.wait(250);
                if (!a.ss.outs.dirty.value) break;
            }
            await a.wait(300);
            return { edited, undone: a.state(), restored: view.ins.title.value === was, steps };
        });
        report("editing an annotation title is journalled",
            out.edited.dirty && !out.edited.unjournaled && out.edited.entries > 0,
            `entries=${out.edited.entries} unjournaled=${out.edited.unjournaled}`);
        report("undoing a title edit returns to clean",
            !out.undone.dirty && out.restored,
            `dirty=${out.undone.dirty} restored=${out.restored} after ${out.steps} undo(s)`);
    }

    // ---- position has no graph property, so it can only mark unsaved
    {
        const out = await page.evaluate(async () => {
            const a = window.__a;
            a.reset(); await a.wait(400);
            const view = a.viewWithAnnotations();
            const anno = view.getAnnotations()[0];
            const was = anno.data.position.slice();
            anno.data.position = [was[0] + 0.1, was[1], was[2]];
            anno.update();
            view.updateAnnotation(anno, true);
            await a.wait(500);
            const st = a.state();
            anno.data.position = was; anno.update(); view.updateAnnotation(anno, true);
            return st;
        });
        report("moving an annotation marks unsaved", out.dirty && out.unjournaled,
            `dirty=${out.dirty} unjournaled=${out.unjournaled}`);
    }

    // ---- adding one
    {
        const out = await page.evaluate(async () => {
            const a = window.__a;
            a.reset(); await a.wait(400);
            const view = a.viewWithAnnotations();
            const Anno = view.getAnnotations()[0].constructor;
            const added = new Anno(undefined);
            added.data.position = [0, 0, 0];
            added.data.direction = [0, 1, 0];
            view.addAnnotation(added);
            await a.wait(400);
            const st = a.state();
            view.removeAnnotation(added);
            return st;
        });
        report("adding an annotation marks unsaved", out.dirty,
            `dirty=${out.dirty} unjournaled=${out.unjournaled}`);
    }

    // ---- removing one
    {
        const out = await page.evaluate(async () => {
            const a = window.__a;
            const view = a.viewWithAnnotations();
            const Anno = view.getAnnotations()[0].constructor;
            const victim = new Anno(undefined);
            victim.data.position = [0, 0, 0];
            victim.data.direction = [0, 1, 0];
            view.addAnnotation(victim);
            await a.wait(300);
            a.reset(); await a.wait(400);
            view.removeAnnotation(victim);
            await a.wait(400);
            return a.state();
        });
        report("removing an annotation marks unsaved", out.dirty,
            `dirty=${out.dirty} unjournaled=${out.unjournaled}`);
    }

    // ---- THE REGRESSION CASE: a model dragging its annotations is not an edit
    {
        const out = await page.evaluate(async () => {
            const a = window.__a;
            a.reset(); await a.wait(500);
            const clean = a.state();

            a.write("CVModel2", "Model.Position", [1.25, 0.5, -2]);
            await a.wait(700);
            const moved = a.state();

            let steps = 0;
            while (a.ss.outs.canUndo.value && steps < 8) {
                a.ss.undo(); ++steps; await a.wait(300);
                if (!a.ss.outs.dirty.value) break;
            }
            await a.wait(500);
            return { clean, moved, undone: a.state(), steps };
        });

        report("moving a model is journalled, not unjournaled",
            out.moved.dirty && !out.moved.unjournaled && out.moved.entries > 0,
            `entries=${out.moved.entries} unjournaled=${out.moved.unjournaled}`);
        report("undoing the move returns the document to clean",
            !out.undone.dirty && !out.undone.unjournaled,
            `dirty=${out.undone.dirty} unjournaled=${out.undone.unjournaled} after ${out.steps} undo(s)`);
    }

    console.log(`\npage errors: ${pageErrors.length}`);
    pageErrors.slice(0, 3).forEach(e => console.log("  ", e.slice(0, 160)));
    const failed = results.filter(r => !r.ok).length;
    console.log(`${results.length - failed}/${results.length} passed`);
    await browser.close();
    process.exit(failed ? 1 : 0);
})();
