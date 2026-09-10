// Is "playing a tour is not an edit" actually fixed, or just order-dependent?
//
// The acceptance driver runs this check after a view-preset check that leaves
// the camera somewhere else, so a tour's snapshot may happen to write values
// that already match - which passes for the wrong reason. This runs the tour
// check on its own, from a freshly loaded scene, and says what got journalled.
const { chromium } = require("playwright");

const SCENE = process.argv[2] || "Mausolée_Seclin";
const URL = `http://localhost:8099/voyager-story-dev.html?root=${encodeURIComponent("/files/" + SCENE)}/&document=scene.svx.json&mode=edit`;

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(URL, { waitUntil: "load" });
    await page.waitForFunction(() => {
        const ss = window.voyagerStory && window.voyagerStory.system.components.get("CVSaveState");
        return !!(ss && ss.isTracking);
    }, null, { timeout: 600000 });

    const out = await page.evaluate(async () => {
        const sys = window.voyagerStory.system;
        const ss = sys.components.get("CVSaveState");
        const doc = sys.components.get("CVDocumentProvider").activeComponent;
        const comps = doc.innerGraph.components.getArray().concat([doc]);
        const find = (t, path) => {
            for (const c of comps) {
                if (c.constructor.typeName !== t) continue;
                for (const p of c.ins.properties) if (p.path === path) return p;
            }
            return null;
        };
        const wait = ms => new Promise(r => setTimeout(r, ms));

        ss.commitEdit(); ss.journal.clear(); ss.markSaved();
        await wait(400);

        const tours = find("CVTours", "Tours.Index");
        if (!tours) return { noTours: true };

        tours.value = 0; tours.set();
        await wait(2000);

        return {
            dirty: ss.outs.dirty.value,
            unjournaled: ss.hasUnjournaledEdits,
            entries: ss.journal.log.map(e => ({ name: e.name, title: e.title })),
        };
    });

    if (out.noTours) console.log("no tours in this scene");
    else {
        const ok = !out.dirty && out.entries.length === 0;
        console.log(`${ok ? "PASS" : "FAIL"}  playing a tour is not an edit  (in isolation)`);
        console.log(`  dirty=${out.dirty} unjournaled=${out.unjournaled} entries=${out.entries.length}`);
        for (const e of out.entries) console.log(`    ${e.name}   "${e.title}"`);
    }
    await browser.close();
})();
