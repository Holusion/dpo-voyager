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
        const comps = doc.innerGraph.components.getArray();
        const find = (t, path) => {
            for (const c of comps) if (c.constructor.typeName === t)
                for (const p of c.ins.properties) if (p.path === path) return p;
            return null;
        };
        ss.commitEdit(); ss.journal.clear(); ss.markSaved();
        const views = comps.filter(c => c.constructor.typeName === "CVAnnotationView");
        const articles = sys.components.get("CVReader") ? null : null;
        const p = find("CVViewer", "Annotations.ActiveId");
        p.value = "nothing"; p.set();
        await new Promise(r => setTimeout(r, 1500));
        return {
            annotationViews: views.length,
            readerArticles: doc.innerGraph.components.getArray()
                .filter(c => c.constructor.typeName === "CVReader")
                .map(c => c.articles.length),
            dirty: ss.outs.dirty.value,
            entries: ss.journal.log.map(e => ({ name: e.name, title: e.title })),
        };
    });
    console.log(JSON.stringify(out, null, 1));
    await browser.close();
})();
