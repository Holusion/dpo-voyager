import { expect } from "chai";

import System from "@ff/graph/System";
import Component, { types } from "@ff/graph/Component";

import { getPersistMode, getPersistedProperties, serializeInputs } from "client/utils/persist";

// normally defined by the client build
(globalThis as any).ENV_DEVELOPMENT = false;

enum EStyle { Plain, Fancy }

class CBase extends Component
{
    static readonly typeName: string = "CBase";

    protected static readonly baseIns = {
        visible: types.Boolean("Base.Visible", true),
    };

    ins = this.addInputs(CBase.baseIns);
}

class CTest extends CBase
{
    static readonly typeName: string = "CTest";

    static readonly persist = {
        visible: "capture" as const,
    };

    protected static readonly testIns = {
        style: types.Enum("Test.Style", EStyle, { preset: EStyle.Fancy, persist: "always" }),
        position: types.Vector3("Test.Position", { preset: [ 1, 2, 3 ], persist: "capture" }),
        derived: types.Number("Test.Derived", { preset: 1, persist: "never" }),
        unmarked: types.Number("Test.Unmarked", 1),
        trigger: types.Event("Test.Trigger"),
    };

    ins = this.addInputs<CBase, typeof CTest.testIns>(CTest.testIns);
}

function createComponent()
{
    const system = new System();
    system.registry.add([ CBase, CTest ]);
    return system.graph.createNode("test").createComponent(CTest);
}

describe("persist", function() {
    it("resolves persist modes from the schema and class overrides", function() {
        const component = createComponent();
        const ins = component.ins;
        expect(getPersistMode(component, ins.visible)).to.equal("capture");
        expect(getPersistMode(component, ins.style)).to.equal("always");
        expect(getPersistMode(component, ins.position)).to.equal("capture");
        expect(getPersistMode(component, ins.derived)).to.equal("never");
        expect(getPersistMode(component, ins.unmarked)).to.equal("never");
        expect(getPersistMode(component, ins.trigger)).to.equal("never");
    });

    it("does not leak class overrides to the base class", function() {
        const system = new System();
        system.registry.add(CBase);
        const base = system.graph.createNode("base").createComponent(CBase);
        expect(getPersistMode(base, base.ins.visible)).to.equal("never");
    });

    it("lists properties by mode", function() {
        const component = createComponent();
        expect(getPersistedProperties(component, "capture").map(p => p.key)).to.deep.equal([ "visible", "position" ]);
    });

    it("serializes persisted inputs", function() {
        const component = createComponent();
        expect(serializeInputs(component)).to.deep.equal({
            visible: true,
            style: "Fancy",
            position: [ 1, 2, 3 ],
        });
    });

    it("uses provided values in place of live ones", function() {
        const component = createComponent();
        const captured = new Map<any, any>([ [ component.ins.position, [ 4, 5, 6 ] ] ]);
        component.ins.position.setValue([ 7, 8, 9 ]);
        component.ins.style.setValue(EStyle.Plain);

        const values = serializeInputs(component, captured);
        expect(values.position).to.deep.equal([ 4, 5, 6 ]);
        expect(values.style).to.equal("Plain");
    });

    it("copies array values", function() {
        const component = createComponent();
        const values = serializeInputs(component);
        values.position[0] = 42;
        expect(component.ins.position.value).to.deep.equal([ 1, 2, 3 ]);
    });
});
