import { expect } from "chai";

import System from "@ff/graph/System";
import Component, { types } from "@ff/graph/Component";
import CTweenMachine, { EEasingCurve } from "@ff/graph/components/CTweenMachine";
import { IPulseContext } from "@ff/graph/components/CPulse";


class CTarget extends Component
{
    static readonly typeName: string = "CTarget";

    ins = this.addInputs({
        num: types.Number("Target.Number"),
        vec: types.Vector3("Target.Vector"),
        str: types.String("Target.String", "A"),
    });
}

/** Minimal pulse context: CTweenMachine.tick() only reads secondsElapsed. */
function at(secondsElapsed: number): IPulseContext
{
    return { time: new Date(), secondsElapsed, secondsDelta: 0, frameNumber: 0, tickUpdated: false, tockUpdated: false };
}

describe("CTweenMachine", function(){
    let machine: CTweenMachine;
    let target: CTarget;

    beforeEach(function(){
        const system = new System();
        system.registry.add([ CTweenMachine, CTarget ]);
        const node = system.graph.createNode("Test");
        machine = node.createComponent(CTweenMachine);
        target = node.createComponent(CTarget);

        machine.addTargetProperty(target.ins.num);
        machine.addTargetProperty(target.ins.vec);
        machine.addTargetProperty(target.ins.str);
    });

    /** Puts the targets in `from`, then tweens to `to` and returns after the given frame times (seconds, tween starts at 0). */
    function tween(from: any[], to: any[], frames: number[], curve = EEasingCurve.Linear)
    {
        target.ins.num.setValue(from[0]);
        target.ins.vec.setValue(from[1].slice());
        target.ins.str.setValue(from[2]);

        const id = machine.setState({ id: "dest", values: to, curve, duration: 1, threshold: 0.5 });
        machine.tweenTo(id, 0);
        frames.forEach(t => machine.tick(at(t)));
    }

    describe("final frame", function(){
        // These pairs are ordinary camera-like values for which vA + 1 * (vB - vA) !== vB in IEEE 754 doubles.
        // A tween computing its last frame by interpolation lands one ULP (or more) away from the stored state.

        it("lands exactly on a scalar target", function(){
            expect(42.1 + 1 * (-8.4 - 42.1), "precondition: the interpolation is lossy").to.not.equal(-8.4);

            tween([ 42.1, [ 0, 0, 0 ], "A" ], [ -8.4, [ 0, 0, 0 ], "B" ], [ 0.5, 1 ]);

            expect(machine.outs.tweening.value).to.be.false;
            expect(target.ins.num.value).to.equal(-8.4);
        });

        it("lands exactly on every component of a vector target", function(){
            const to = [ -8.4, 0.1, 12.7 ];
            tween([ 0, [ 42.1, 1e6, -25.3 ], "A" ], [ 0, to, "B" ], [ 0.5, 1 ]);

            expect(target.ins.vec.value).to.deep.equal(to);
        });

        it("lands exactly when the last tick overshoots the duration", function(){
            tween([ 42.1, [ 0, 0, 0 ], "A" ], [ -8.4, [ 0, 0, 0 ], "B" ], [ 0.3, 1.7 ]);

            expect(target.ins.num.value).to.equal(-8.4);
        });

        it("lands exactly with a non-linear curve", function(){
            tween([ 42.1, [ 0, 0, 0 ], "A" ], [ -8.4, [ 0, 0, 0 ], "B" ], [ 0.25, 0.75, 1 ], EEasingCurve.EaseQuad);

            expect(target.ins.num.value).to.equal(-8.4);
        });

        it("restores the exact starting state when tweening back to it", function(){
            // e.g. exiting a tour: the view should return to where it was, not one ULP off.
            const startId = machine.setState({ id: "start", values: [ 3.3, [ 3.3, 7.7, 0 ], "A" ], curve: EEasingCurve.Linear, duration: 1, threshold: 0.5 });

            tween([ 3.3, [ 3.3, 7.7, 0 ], "A" ], [ -8.4, [ -8.4, -8.4, 0 ], "B" ], [ 1 ]);
            machine.tweenTo(startId, 10);
            machine.tick(at(11));

            expect(target.ins.num.value).to.equal(3.3);
            expect(target.ins.vec.value).to.deep.equal([ 3.3, 7.7, 0 ]);
        });

        it("is only off by rounding error (not a logic bug)", function(){
            // Documents the magnitude of the problem: visually irrelevant, but enough to break exact comparisons.
            tween([ 42.1, [ 42.1, 1e6, -25.3 ], "A" ], [ -8.4, [ -8.4, 0.1, 12.7 ], "B" ], [ 1 ]);

            expect(target.ins.num.value).to.be.closeTo(-8.4, 1e-9);
            target.ins.vec.value.forEach((v, i) => expect(v).to.be.closeTo([ -8.4, 0.1, 12.7 ][i], 1e-9));
        });
    });

    describe("intermediate frames", function(){
        it("interpolates numbers", function(){
            tween([ 0, [ 0, 0, 0 ], "A" ], [ 10, [ 2, 4, 8 ], "B" ], [ 0.25 ]);

            expect(machine.outs.tweening.value).to.be.true;
            expect(target.ins.num.value).to.equal(2.5);
            expect(target.ins.vec.value).to.deep.equal([ 0.5, 1, 2 ]);
        });

        it("switches non-number values at the threshold", function(){
            tween([ 0, [ 0, 0, 0 ], "A" ], [ 10, [ 0, 0, 0 ], "B" ], [ 0.25 ]);
            expect(target.ins.str.value).to.equal("A");

            machine.tick(at(0.5));
            expect(target.ins.str.value).to.equal("B");
        });

        it("leaves a target untouched when the state value is null", function(){
            tween([ 3, [ 0, 0, 0 ], "A" ], [ null, [ 1, 1, 1 ], "B" ], [ 0.5, 1 ]);

            expect(target.ins.num.value).to.equal(3);
        });
    });
});
