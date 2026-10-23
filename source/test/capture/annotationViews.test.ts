import { expect } from "chai";

import CLight from "@ff/scene/components/CLight";

import CVAnnotationView from "client/components/CVAnnotationView";
import CVAnnotationsTask from "client/components/CVAnnotationsTask";
import CVModel2 from "client/components/CVModel2";
import CVSnapshots from "client/components/CVSnapshots";
import CVSetup from "client/components/CVSetup";
import NVNode from "client/nodes/NVNode";
import CVNodeProvider from "client/components/CVNodeProvider";
import NodeTree from "client/ui/story/NodeTree";
import { ELightType } from "client/components/lights/CVLight";
import Annotation from "client/models/Annotation";

import { activateTask, createDocumentData, createStory, IStory } from "../helpers/story";

/**
 * Annotation views, recorded and played from the annotations task and by clicking annotations: playing them sets the camera
 * and leaves them as saved.
 */
describe("Annotation views", function() {
    let story: IStory;
    let setup: CVSetup;
    let machine: CVSnapshots;
    let view: CVAnnotationView;
    let task: CVAnnotationsTask;
    let a1: Annotation;

    const orbit = () => setup.navigation.ins.orbit;
    const savedStates = () => story.document.deflateDocument().setups[0].snapshots.states;
    const viewState = () => JSON.parse(JSON.stringify(savedStates().find(state => state.id === a1.data.viewId)));

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
        story = createStory(createDocumentData([
            { name: "Model A", annotations: [
                { id: "a1", position: [0, 0, 0], direction: [0, 1, 0], scale: 5 },
                { id: "a2", position: [1, 0, 0], direction: [0, 1, 0], scale: 5 },
            ]},
        ]));
        setup = story.document.setup;
        machine = setup.snapshots;
        const model = story.document.innerComponents.getArray(CVModel2)[0];
        view = model.getComponent(CVAnnotationView);
        a1 = view.getAnnotationById("a1");
        settle();

        // the model is selected, as the task needs to edit its annotations
        story.system.getMainComponent(CVNodeProvider).activeNode = model.node;
        task = activateTask(story, CVAnnotationsTask);
        expect(task.activeAnnotations).to.equal(view);
        // views only play with annotations shown
        setup.viewer.ins.annotationsVisible.setValue(true);
        story.update();

        // a1 looks from the side, saved as the task's Save button does
        view.activeAnnotation = a1;
        orbit().setValue([0, 90, 0]);
        story.update();
        task.saveAnnotationView();
        view.activeAnnotation = null;
        orbit().setValue([0, 0, 0]);
        settle();
    });

    it("are left unchanged by playing them", function() {
        const saved = viewState();
        orbit().setValue([0, 400, 0]);
        story.update();

        view.activeAnnotation = a1;
        settle();

        // the shortest way from 400°
        expect(orbit().value.map(Math.round)).to.deep.equal([0, 450, 0]);
        expect(viewState()).to.deep.equal(saved);
    });

    it("play from the task's View button as when clicking them", function() {
        view.activeAnnotation = a1;
        settle();
        const saved = viewState();
        orbit().setValue([0, 400, 0]);
        story.update();

        task.restoreAnnotationView();
        settle();

        expect(orbit().value.map(Math.round)).to.deep.equal([0, 450, 0]);
        expect(viewState()).to.deep.equal(saved);
    });

    it("only set the camera, even for lights added after them", function() {
        machine.targetFeatures["lights"] = true;
        machine.updateTargets();

        const lights = story.document.innerGraph.findNodeByName("Lights") as NVNode;
        const node = NodeTree.createLightNode(lights, ELightType.point, "Point");
        lights.transform.addChild(node.transform);
        const light = node.getComponent(CLight);
        story.update();
        light.ins.intensity.setValue(5);
        story.update();

        view.activeAnnotation = a1;
        settle();

        expect(orbit().value.map(Math.round)).to.deep.equal([0, 90, 0]);
        expect(light.ins.intensity.value).to.equal(5);
    });
});
