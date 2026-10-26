import { expect } from "chai";
import { EActionType } from "client/schema/meta";
import { tourAction, tourActionsFixture } from "../fixtures/tourActions";

describe("Scene-owned tour action playback", function() {
    it("queues and executes a scene state change without a model or a tour-step snapshot", function() {
        const f = tourActionsFixture();
        f.snapshots.setState({ id: "state", values: [], curve: 0, duration: 0, threshold: 0 });
        f.meta.actions.items = [tourAction("scene-action", "StateChange", { stateId: "state" })];
        expect(f.snapshots.getState(f.step.id)).to.equal(undefined);
        expect(() => (f.actions as any).onTourStep()).not.to.throw();
        (f.actions as any).onTransitionEnd();
        expect(f.snapshots.addIns.deltaID.value).to.equal("state");
        expect(f.snapshots.addIns.activateDelta.changed).to.equal(true);
    });

    it("does not execute model-dependent actions when the owner has no model", function() {
        const f = tourActionsFixture();
        f.meta.actions.items = [tourAction("animation", "PlayAnimation"), tourAction("annotation", "ShowAnnotation")];
        (f.actions as any).onTourStep();
        expect(() => (f.actions as any).onTransitionEnd()).not.to.throw();
        expect(f.actions.outs.fired.changed).to.equal(false);
    });
});

describe("Scene-owned action editing", function() {
    it("clears model-specific options and loads the scene's metadata", function() {
        const f = tourActionsFixture();
        f.task.ins.animation.setOptions(["None", "Previous model animation"]);
        f.task.ins.syncWith.setOptions(["None", "Previous model animation"]);
        f.task.ins.annotation.setOptions(["None", "Previous annotation"]);
        (f.task as any).onActiveNode(null, f.owner);
        expect(f.task.meta).to.equal(f.meta);
        expect(f.task.ins.animation.schema.options).to.deep.equal(["None"]);
        expect(f.task.ins.syncWith.schema.options).to.deep.equal(["None"]);
        expect(f.task.ins.annotation.schema.options).to.deep.equal(["None"]);
    });

    it("selects a scene state action without requiring annotation or model components", function() {
        const f = tourActionsFixture();
        f.snapshots.deltaStates.push({ id: "state", title: "Global state" } as any);
        f.meta.actions.items = [tourAction("scene-action", "StateChange", { stateId: "state" })];
        (f.task as any).onActiveNode(null, f.owner);
        f.task.ins.tour.setOptions(["None", "Tour"]);
        f.task.ins.activeId.setValue("scene-action");
        expect(() => (f.task as any).onActionChange()).not.to.throw();
        expect(f.task.ins.name.value).to.equal("scene-action");
        expect(f.task.ins.type.value).to.equal(EActionType.StateChange);
        expect(f.task.ins.state.value).to.equal(1);
        expect(f.task.ins.tour.value).to.equal(1);
        expect(f.task.ins.tourStep.value).to.equal(0);
    });

});
