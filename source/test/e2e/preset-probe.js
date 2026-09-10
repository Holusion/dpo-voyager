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
    }, null, { timeout: 240000 });
    const out = await page.evaluate(async () => {
        const sys = window.voyagerStory.system;
        const ss = sys.components.get("CVSaveState");
        const doc = sys.components.get("CVDocumentProvider").activeComponent;
        const find = (t, path) => {
            for (const c of doc.innerGraph.components.getArray()) {
                if (c.constructor.typeName !== t) continue;
                for (const p of c.ins.properties) if (p.path === path) return p;
            }
            return null;
        };
        ss.commitEdit(); ss.journal.clear(); ss.markSaved();
        const p = find("CVOrbitNavigation", "Camera.ViewPreset");
        p.value = 1; p.set();
        await new Promise(r => setTimeout(r, 4000));
        return { dirty: ss.outs.dirty.value, names: ss.journal.log.map(e => e.name),
                 titles: ss.journal.log.map(e => e.title) };
    });
    console.log(JSON.stringify(out, null, 1));
    await browser.close();
})();
