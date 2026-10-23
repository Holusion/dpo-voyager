import { expect } from "chai";

import CLight from "@ff/scene/components/CLight";

import CVModel2 from "client/components/CVModel2";
import CVSnapshots, { EEasingCurve } from "client/components/CVSnapshots";
import CVTours from "client/components/CVTours";
import { IDocument } from "client/schema/document";

import { createDocumentData, createStory, IStory } from "../helpers/story";

/**
 * Lights follow the models' bounds: fitted to them when they change, but where the document saved them.
 */
describe("Lights", function() {
    let data: IDocument;
    let story: IStory;
    let machine: CVSnapshots;
    let tours: CVTours;
    let modelB: CVModel2;

    const lights = () => story.system.getComponents(CLight).map(light => [ light.transform.ins.position.cloneValue(), light.transform.ins.scale.cloneValue() ]);

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

    beforeEach(function() {
        data = createDocumentData([
            { name: "Model A" },
            { name: "Model B", translation: [40, 0, 0] },
        ]);
        // saved bounds, which the lights are fitted to
        data.models.forEach(model => model.boundingBox = { min: [-10, -10, -10], max: [10, 10, 10] });
        story = createStory(data);
        machine = story.document.setup.snapshots;
        tours = story.document.setup.tours;
        modelB = story.document.innerComponents.getArray(CVModel2).find(model => model.node.name === "Model B");
        settle();
    });

    it("stay where the document saved them", function() {
        const saved = data.nodes.find(node => node.name === "Shadow Caster #1").translation;
        const light = story.system.getComponents(CLight).find(light => light.node.name === "Shadow Caster #1");
        expect(light.transform.ins.position.value).to.deep.equal(saved);
    });

    it("are fitted again when a model is hidden", function() {
        const before = lights();
        modelB.ins.visible.setValue(false);
        settle();
        expect(lights()).to.not.deep.equal(before);
    });

    it("are fitted again when leaving a tour during which a model was hidden", function() {
        modelB.ins.visible.setValue(false);
        settle();
        const fitted = lights();
        modelB.ins.visible.setValue(true);
        settle();

        tours.fromData([{ title: "Tour", steps: [] } as any]);
        // as the tour menu does: tours are shown, then one is picked
        tours.ins.enabled.setValue(true);
        story.update();
        tours.ins.tourIndex.setValue(0);
        settle();
        modelB.ins.visible.setValue(false);
        settle();
        tours.ins.enabled.setValue(false);
        settle();

        expect(modelB.ins.visible.value).to.equal(false);
        expect(lights()).to.deep.equal(fitted);
    });

    it("stay where they are while a tour step hides a model", function() {
        machine.targetFeatures["models"] = true;
        machine.updateTargets();
        modelB.ins.visible.setValue(false);
        story.update();
        machine.setState({ id: "s1", values: machine.getCurrentValues(), curve: EEasingCurve.Linear, duration: 1, threshold: 0.5 });
        modelB.ins.visible.setValue(true);
        settle();
        tours.fromData([{ title: "Tour", steps: [{ id: "s1", title: "1" }] } as any]);
        const before = lights();

        // as the tour menu does: tours are shown, then one is picked
        tours.ins.enabled.setValue(true);
        story.update();
        tours.ins.tourIndex.setValue(0);
        settle();
        expect(modelB.ins.visible.value).to.equal(false);
        expect(lights()).to.deep.equal(before);

        tours.ins.enabled.setValue(false);
        settle();
        expect(modelB.ins.visible.value).to.equal(true);
        expect(lights()).to.deep.equal(before);
    });
});
