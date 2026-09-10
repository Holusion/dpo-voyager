const { chromium } = require("playwright");
const SCENE = process.argv[2] || "Mausolée_Seclin";
const URL = `http://localhost:8099/voyager-story-dev.html?root=/files/${encodeURIComponent(SCENE)}/&document=scene.svx.json&mode=edit`;
(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.route("**/*", route =>
        route.request().url().includes("cdn.jsdelivr.net") ? route.abort("failed") : route.continue());
    // patch the loading manager as soon as the bundle defines it
    await page.addInitScript(() => {
        window.__items = [];
        const hook = () => {
            const sys = window.voyagerStory && window.voyagerStory.system;
            const am = sys && sys.components.get("CVAssetManager");
            if (!am) return false;
            const lm = am.loadingManager;
            for (const k of ["itemStart", "itemEnd", "itemError"]) {
                const orig = lm[k].bind(lm);
                lm[k] = url => { window.__items.push([k, url]); return orig(url); };
            }
            return true;
        };
        const iv = setInterval(() => { if (hook()) clearInterval(iv); }, 5);
    });
    await page.goto(URL, { waitUntil: "load" });
    await page.waitForTimeout(35000);
    const st = await page.evaluate(() => {
        const sys = window.voyagerStory.system;
        const am = sys.components.get("CVAssetManager");
        const bal = {};
        for (const [k, u] of window.__items) {
            bal[u] = bal[u] || { start: 0, end: 0, error: 0 };
            bal[u][k === "itemStart" ? "start" : k === "itemEnd" ? "end" : "error"]++;
        }
        const leaked = Object.entries(bal).filter(([, v]) => v.start !== v.end);
        return { outsBusy: am.outs.busy.value, lmIsBusy: am.loadingManager.isBusy,
                 total: window.__items.length, leaked };
    });
    console.log(JSON.stringify(st, null, 2));
    await browser.close();
})();
