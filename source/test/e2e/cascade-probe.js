// Why an edit made just after a model move can go missing.
//
// Moving a model recomputes the scene bounding box, and CVFloor recalculates
// its own radius and position from it - so CVFloor is marked changed by a write
// nobody made. The suspension then carries into the next frame for every
// component that was changed when the bracket closed, CVFloor among them, and
// the next thing written on CVFloor is absorbed as if it were derived.
//
// This writes Model.Position and then Floor.Opacity at a controlled distance
// and reports whether the opacity edit reached the journal.
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

    await page.evaluate(() => {
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
        window.__c = {
            ss, find,
            write(t, path, v) {
                const p = find(t, path);
                if (Array.isArray(p.value)) { for (let i = 0; i < v.length; ++i) p.value[i] = v[i]; }
                else p.value = v;
                p.set();
            },
            frames(n) {
                return new Promise(resolve => {
                    let i = 0;
                    const step = () => (++i >= n ? resolve() : requestAnimationFrame(step));
                    requestAnimationFrame(step);
                });
            },
            reset() { ss.commitEdit(); ss.journal.clear(); ss.markSaved(); },
            names: () => ss.journal.log.map(e => e.name),
            read: (t, p) => JSON.stringify(find(t, p).value),
        };
    });

    // gap = frames waited between the model move and the floor edit
    for (const gap of [ 0, 1, 2, 3, 6 ]) {
        const out = await page.evaluate(async gap => {
            const c = window.__c;
            c.reset();
            await c.frames(4);

            const before = c.read("CVFloor", "Floor.Opacity");
            const radius = c.read("CVFloor", "Floor.Radius");
            const position = c.read("CVFloor", "Floor.Position");

            c.write("CVModel2", "Model.Position", [ Math.random(), 0, 0 ]);
            if (gap > 0) await c.frames(gap);

            // What edit detection is holding at the moment of the write.
            const held = {
                frame: c.ss._frame,
                until: c.ss._suspendUntilFrame,
                blanket: c.ss._deferBlanket,
                deferred: [ ...c.ss._deferred ].map(x => x.constructor.typeName),
                floorChanged: c.find("CVFloor", "Floor.Opacity").group.linkable.changed,
            };

            c.write("CVFloor", "Floor.Opacity", Number((0.2 + Math.random() * 0.5).toFixed(3)));
            await c.frames(6);

            return {
                gap,
                held,
                positionMoved: position !== c.read("CVFloor", "Floor.Position"),
                names: c.names(),
                opacityBefore: before,
                opacityNow: c.read("CVFloor", "Floor.Opacity"),
                radiusMoved: radius !== c.read("CVFloor", "Floor.Radius"),
                dirty: c.ss.outs.dirty.value,
            };
        }, gap);

        const journalled = out.names.some(n => n === "Floor.Opacity" || n.startsWith("Floor.Opacity"));
        console.log(`gap ${out.gap} frame(s): floor opacity ${out.opacityBefore} -> ${out.opacityNow}, `
            + `journalled=${journalled ? "yes" : "NO - SWALLOWED"}, floor radius moved by the cascade=${out.radiusMoved}`);
        console.log(`   floor position moved by the cascade=${out.positionMoved}`);
        console.log(`   at the moment of the write: frame ${out.held.frame}, suspended until ${out.held.until}, `
            + `blanket=${out.held.blanket}, floor already marked changed=${out.held.floorChanged}`);
        console.log(`   deferred: ${out.held.deferred.join(", ") || "(nothing)"}`);
        console.log(`   entries: ${out.names.join(" | ") || "(none)"}`);
    }

    await browser.close();
})();
