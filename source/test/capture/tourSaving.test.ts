import { expect } from "chai";

import CVModel2 from "client/components/CVModel2";
import CVSnapshots, { EEasingCurve } from "client/components/CVSnapshots";
import CVTours from "client/components/CVTours";

import { createDocumentData, createStory, IStory } from "../helpers/story";

/**
 * Saving and leaving a tour while one of its steps is shown: what the step shows isn't the document's.
 */
describe("Tours", function() {
    let story: IStory;
    let machine: CVSnapshots;
    let tours: CVTours;
    let modelA: CVModel2;
    let modelB: CVModel2;

    /** Runs graph updates (a frame each) until no state is tweening: tweens triggered by events start on the next update */
    function settle()
    {
        story.update();
        for (let i = 0; i < 1000; ++i) {
            story.update();
            if (!machine.outs.tweening.value) {
                story.update();
                return;
            }
        }
        throw new Error("still tweening");
    }
    function save()
    {
        const document = story.document.deflateDocument();
        const node = (model: CVModel2) => document.nodes.find(node => node.name === model.node.name);
        return {
            visibleB: document.models[node(modelB).model].visible !== false,
            translationA: node(modelA).translation || [0, 0, 0],
        };
    }
    function showStep()
    {
        // as the tour menu does: tours are shown, then one is picked
        tours.ins.enabled.setValue(true);
        story.update();
        tours.ins.tourIndex.setValue(0);
        settle();
        expect(modelA.transform.ins.position.value).to.deep.equal([0, 0, 3]);
        expect(modelB.ins.visible.value).to.equal(false);
    }

    beforeEach(function() {
        story = createStory(createDocumentData([
            { name: "Model A" },
            { name: "Model B", translation: [40, 0, 0] },
        ]));
        const setup = story.document.setup;
        machine = setup.snapshots;
        tours = setup.tours;
        const models = story.document.innerComponents.getArray(CVModel2);
        modelA = models.find(model => model.node.name === "Model A");
        modelB = models.find(model => model.node.name === "Model B");
        settle();

        // a tour of models, as the tours task records it: its step moves model A and hides model B
        machine.targetFeatures["models"] = true;
        machine.updateTargets();
        modelA.transform.ins.position.setValue([0, 0, 3]);
        modelB.ins.visible.setValue(false);
        story.update();
        machine.setState({ id: "s1", values: machine.getCurrentValues(), curve: EEasingCurve.Linear, duration: 1, threshold: 0.5 });
        modelA.transform.ins.position.setValue([0, 0, 0]);
        modelB.ins.visible.setValue(true);
        story.update();
        tours.fromData([{ title: "Tour", steps: [{ id: "s1", title: "1" }] } as any]);
    });

    describe("saved while a step is shown", function() {
        it("save the scene, not what the step shows", function() {
            showStep();
            expect(save()).to.deep.equal({ visibleB: true, translationA: [0, 0, 0] });
            // the scene still shows the step
            expect(modelA.transform.ins.position.value).to.deep.equal([0, 0, 3]);
            expect(modelB.ins.visible.value).to.equal(false);
        });

        it("save what was edited since the step was shown", function() {
            showStep();
            modelA.transform.ins.position.setValue([5, 0, 0]);
            story.update();
            expect(save()).to.deep.equal({ visibleB: true, translationA: [5, 0, 0] });
        });

        it("save the scene mid-transition", function() {
            // as the tour menu does: tours are shown, then one is picked
            tours.ins.enabled.setValue(true);
            story.update();
            tours.ins.tourIndex.setValue(0);
            for (let i = 0; i < 10; ++i) {
                story.update();
            }
            expect(machine.outs.tweening.value).to.equal(true);
            expect(save()).to.deep.equal({ visibleB: true, translationA: [0, 0, 0] });
        });

        it("leave out what was recorded into the step", function() {
            showStep();
            modelA.transform.ins.position.setValue([5, 0, 0]);
            story.update();
            // the tours task's Update step
            machine.ins.store.set();
            story.update();
            expect(save()).to.deep.equal({ visibleB: true, translationA: [0, 0, 0] });
        });
    });

    describe("left while a step is shown", function() {
        it("restore the scene", function() {
            showStep();
            tours.ins.enabled.setValue(false);
            settle();
            expect(modelA.transform.ins.position.value).to.deep.equal([0, 0, 0]);
            expect(modelB.ins.visible.value).to.equal(true);
        });

        it("restore the camera, moved during the tour", function() {
            const orbit = story.document.setup.navigation.ins.orbit;
            const before = orbit.cloneValue();
            showStep();
            orbit.setValue([0, 45, 0]);
            story.update();
            tours.ins.enabled.setValue(false);
            settle();
            expect(orbit.value).to.deep.equal(before);
        });

        it("keep what was edited since the step was shown", function() {
            showStep();
            modelA.transform.ins.position.setValue([5, 0, 0]);
            story.update();
            tours.ins.enabled.setValue(false);
            settle();
            expect(modelA.transform.ins.position.value).to.deep.equal([5, 0, 0]);
            expect(modelB.ins.visible.value).to.equal(true);
            expect(save()).to.deep.equal({ visibleB: true, translationA: [5, 0, 0] });
        });
    });
});
