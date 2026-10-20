import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

import { applyState, composeStep, diffValues, IPathValues, sparsifySteps, ValueMap } from "client/utils/tourSteps";

const map = (o: Record<string, any>): ValueMap => new Map(Object.entries(o));
const pv = (o: Record<string, any>): IPathValues => ({ paths: Object.keys(o), values: Object.values(o) });
const obj = (m: ValueMap) => Object.fromEntries(m);

describe("composeStep", function() {
    const base = map({ cam: [0, 0], article: "", annotations: true });
    const steps = [
        [pv({ cam: [1, 0] })],
        [pv({ cam: [2, 0], article: "a1" })],
        [],                                     // step without state holds the previous one
        [pv({ annotations: false }), pv({ cam: [3, 0] })],
    ];

    it("overlays states of steps 0..index on the base", function() {
        expect(obj(composeStep(base, steps, 0))).to.deep.equal({ cam: [1, 0], article: "", annotations: true });
        expect(obj(composeStep(base, steps, 1))).to.deep.equal({ cam: [2, 0], article: "a1", annotations: true });
        expect(obj(composeStep(base, steps, 2))).to.deep.equal(obj(composeStep(base, steps, 1)));
        expect(obj(composeStep(base, steps, 3))).to.deep.equal({ cam: [3, 0], article: "a1", annotations: false });
    });
    it("gives a step the same values whichever step it is reached from", function() {
        // going back from step 3 to step 1 resets annotations, which step 1 never recorded
        expect(composeStep(base, steps, 1).get("annotations")).to.equal(true);
    });
    it("returns the base before the first step", function() {
        expect(obj(composeStep(base, steps, -1))).to.deep.equal(obj(base));
    });
});

describe("diffValues", function() {
    it("keeps only changed values, plus forced paths", function() {
        const reference = map({ cam: [1, 2], article: "a", opacity: 1 });
        const current = map({ cam: [1, 2], article: "b", opacity: 1, added: 3 });
        expect(diffValues(reference, current)).to.deep.equal(pv({ article: "b", added: 3 }));
        expect(diffValues(reference, current, ["cam"])).to.deep.equal(pv({ cam: [1, 2], article: "b", added: 3 }));
    });
    it("compares dates by value", function() {
        const reference = map({ d: new Date(5) });
        expect(diffValues(reference, map({ d: new Date(5) })).paths).to.deep.equal([]);
        expect(diffValues(reference, map({ d: "1970-01-01T00:00:00.005Z" })).paths).to.deep.equal([]);
    });
});

/** Legacy semantics: each step snapshot is absolute; a step without snapshot holds the scene. */
function legacyPlay(start: ValueMap, steps: IPathValues[], index: number): ValueMap
{
    const scene = new Map(start);
    for (let i = 0; i <= index; ++i) {
        if (steps[i]) applyState(scene, steps[i]);
    }
    return scene;
}

/** Asserts the sparse tour shows, at each step, exactly the legacy snapshot (whatever the pre-tour state). */
function expectEquivalent(legacy: IPathValues[], sparse: IPathValues[])
{
    const sparseSteps = sparse.map(s => s ? [s] : []);
    const preTour = map({ unrelated: 42 });
    legacy.forEach((step, k) => {
        const expected = obj(legacyPlay(preTour, legacy, k));
        expect(obj(composeStep(preTour, sparseSteps, k)), `step ${k}`).to.deep.equal(expected);
    });
}

describe("sparsifySteps", function() {
    const legacy = [
        pv({ cam: [1, 0], article: "", annotations: true }),
        pv({ cam: [2, 0], article: "a1", annotations: true }),
        pv({ cam: [2, 0], article: "a1", annotations: false }),
        null,
        pv({ cam: [1, 0], article: "", annotations: true }),
    ];

    it("keeps the first step complete and later steps sparse", function() {
        const sparse = sparsifySteps(legacy);
        expect(sparse[0]).to.deep.equal(legacy[0]);
        expect(sparse[1]).to.deep.equal(pv({ cam: [2, 0], article: "a1" }));
        expect(sparse[2]).to.deep.equal(pv({ annotations: false }));
        expect(sparse[3]).to.equal(null);
        expect(sparse[4]).to.deep.equal(pv({ cam: [1, 0], article: "", annotations: true }));
    });
    it("keeps forced paths of every step", function() {
        const sparse = sparsifySteps(legacy, ["cam"]);
        expect(sparse[2]).to.deep.equal(pv({ cam: [2, 0], annotations: false }));
    });
    it("composes to the legacy snapshots at every step", function() {
        expectEquivalent(legacy, sparsifySteps(legacy));
        expectEquivalent(legacy, sparsifySteps(legacy, ["cam"]));
    });
    it("skips null placeholder values (annotation views)", function() {
        const sparse = sparsifySteps([{ paths: ["cam", "x"], values: [[1, 0], null] }]);
        expect(sparse[0]).to.deep.equal(pv({ cam: [1, 0] }));
    });

    describe("on local scenes", function() {
        const filesDir = process.env.TOUR_SCENES_DIR || path.resolve(__dirname, "../../../files");
        const scenes = fs.existsSync(filesDir) ? fs.readdirSync(filesDir, { recursive: true } as any)
            .map(String).filter(f => f.endsWith(".svx.json") && !f.includes("codeql")) : [];

        scenes.forEach(file => {
            const document = JSON.parse(fs.readFileSync(path.join(filesDir, file), "utf8"));
            (document.setups || []).filter(setup => setup.snapshots && setup.tours).forEach(setup => {
                it(`composes to the legacy snapshots: ${file}`, function() {
                    const { targets, states } = setup.snapshots;
                    const byId = new Map(states.map(state => [state.id, state]));
                    setup.tours.forEach(tour => {
                        const legacy = tour.steps.map(step => {
                            const state: any = byId.get(step.id);
                            return state ? { paths: targets, values: state.values } : null;
                        });
                        const sparse = sparsifySteps(legacy, targets.filter(t => t.includes("/navigation/")));
                        expectEquivalent(legacy, sparse);
                        const before = legacy.reduce((n, s) => n + (s ? s.paths.length : 0), 0);
                        const after = sparse.reduce((n, s) => n + (s ? s.paths.length : 0), 0);
                        this.test.title += ` (${before} -> ${after} values)`;
                    });
                });
            });
        });
    });
});
