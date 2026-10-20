import { expect } from "chai";

import System from "@ff/graph/System";
import Component, { types } from "@ff/graph/Component";
import CTweenMachine, { EEasingCurve, IDeltaState } from "@ff/graph/components/CTweenMachine";

(globalThis as any).ENV_DEVELOPMENT = false;

class CProbe extends Component
{
    static readonly typeName = "CProbe";
    ins = this.addInputs({
        a: types.Number("A", 1),
        b: types.Number("B", 2),
        c: types.Number("C", 3),
        d: types.Number("D", 4),
    });
}

function setup()
{
    const system = new System();
    system.registry.add([CTweenMachine, CProbe]);
    const node = system.graph.createNode("n");
    const machine = node.createComponent(CTweenMachine);
    const probe = node.createComponent(CProbe);
    return { machine, probe };
}

describe("CTweenMachine delta states", function() {
    it("are not altered when global targets are added and removed", function() {
        const { machine, probe } = setup();
        machine.addTargetProperty(probe.ins.a);

        const delta: IDeltaState = {
            id: "delta", title: "delta", curve: EEasingCurve.Linear, duration: 1, threshold: 0.5,
            paths: ["b", "c", "d"].map(key => probe.id + "/" + key), values: [20, 30, 40],
        };
        machine.setState(delta);

        // e.g. what StatePanel.onClickRecord does when it temporarily includes every feature
        machine.addTargetProperty(probe.ins.b);
        machine.addTargetProperty(probe.ins.c);
        machine.removeTargetProperty(probe.ins.b);
        machine.removeTargetProperty(probe.ins.c);

        expect(delta.values).to.deep.equal([20, 30, 40]);
    });
});
