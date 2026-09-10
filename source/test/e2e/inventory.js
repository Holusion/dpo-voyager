const { chromium } = require("playwright");
const SCENE = process.argv[2] || "Mausolée_Seclin";
const URL = `http://localhost:8099/voyager-story-dev.html?root=/files/${encodeURIComponent(SCENE)}/&document=scene.svx.json&mode=edit`;
(async () => {
    const b = await chromium.launch();
    const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
    await p.goto(URL, { waitUntil: "load" });
    await p.waitForFunction(() => {
        const sys = window.voyagerStory && window.voyagerStory.system;
        const ss = sys && sys.components.get("CVSaveState");
        return !!(ss && ss.isTracking);
    }, null, { timeout: 240000 });
    const out = await p.evaluate(() => {
        const sys = window.voyagerStory.system;
        const doc = sys.components.get("CVDocumentProvider").activeComponent;
        const comps = doc.innerGraph.components.getArray().concat([doc]);
        return comps.map(c => ({
            type: c.constructor.typeName,
            id: c.id,
            props: c.ins.properties
                .filter(pr => !pr.schema.event && pr.type !== "object")
                .map(pr => `${pr.path}:${pr.type}${pr.schema.options ? "[opt " + pr.schema.options.length + "]" : ""}${pr.inLinks.length ? " <-link" : ""} = ${JSON.stringify(pr.value)}`),
        }));
    });
    for (const c of out) {
        console.log(`\n== ${c.type} (#${c.id})`);
        c.props.forEach(x => console.log("   " + x));
    }
    await b.close();
})();
