// Do properties that toData() never writes still mark the document unsaved?
const { chromium } = require("playwright");
const SCENE = process.argv[2] || "Mausolée_Seclin";
const URL = `http://localhost:8099/voyager-story-dev.html?root=${encodeURIComponent("/files/" + SCENE)}/&document=scene.svx.json&mode=edit`;

const CASES = [
    ["CVReader", "Reader.Visible", false],
    ["CVTours", "Tours.Enabled", true],
    ["CVAudioManager", "Audio.CaptionsEnabled", true],
    ["CVOrbitNavigation", "Settings.PointerEnabled", false],
    ["CVOrbitNavigation", "Settings.PromptEnabled", false],
    ["CVOrbitNavigation", "Navigation.AutoRotationSpeed", 20],
    ["CVLanguageManager", "Language.Enabled", true],
    ["CVViewer", "Renderer.Variant", 1],
];

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(URL, { waitUntil: "load" });
    await page.waitForFunction(() => {
        const ss = window.voyagerStory && window.voyagerStory.system.components.get("CVSaveState");
        return !!(ss && ss.isTracking);
    }, null, { timeout: 240000 });
    await page.evaluate(() => {
        const sys = window.voyagerStory.system;
        const ss = sys.components.get("CVSaveState");
        const doc = () => sys.components.get("CVDocumentProvider").activeComponent;
        window.__u = {
            ss,
            find(t, path) {
                const d = doc();
                for (const c of d.innerGraph.components.getArray().concat([d])) {
                    if (c.constructor.typeName !== t) continue;
                    for (const p of c.ins.properties) if (p.path === path) return p;
                }
                return null;
            },
            probe(t, path, v) {
                ss.commitEdit(); ss.journal.clear(); ss.markSaved();
                const p = window.__u.find(t, path);
                if (!p) return { missing: true };
                const was = JSON.stringify(p.value);
                if (was === JSON.stringify(v)) return { same: true, was };
                p.value = v; p.set();
                return { was, now: JSON.stringify(p.value) };
            },
            state: () => ({ dirty: ss.outs.dirty.value, entries: ss.journal.log.length,
                            title: ss.journal.undoTitle }),
        };
    });
    for (const [t, path, v] of CASES) {
        const r = await page.evaluate(a => window.__u.probe(a[0], a[1], a[2]), [t, path, v]);
        await page.waitForTimeout(600);
        const s = await page.evaluate(() => window.__u.state());
        const tag = r.missing ? "ABSENT " : r.same ? "SKIPPED" : (s.dirty ? "DIRTY  " : "clean  ");
        console.log(`${tag} ${t}.${path.padEnd(28)} ${r.missing || r.same ? "" : `${r.was} -> ${r.now}  entries=${s.entries}  "${s.title || ""}"`}`);
    }
    await browser.close();
})();
