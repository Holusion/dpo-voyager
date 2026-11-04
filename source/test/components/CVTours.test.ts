import { expect } from "chai";

import CVSnapshots, { EEasingCurve } from "client/components/CVSnapshots";
import CVTours from "client/components/CVTours";
import { IActiveTourStep } from "client/components/CVViewer";

import { createDocumentData, createStory, IStory } from "../helpers/story";


describe("CVTours", function() {
    let story: IStory;
    let tours: CVTours;
    let machine: CVSnapshots;
    let events: IActiveTourStep[];

    const orbit = () => story.document.setup.navigation.ins.orbit;

    /** Runs the given number of one-frame updates (60fps). */
    function frames(count: number)
    {
        for (let i = 0; i < count; ++i) {
            story.update();
        }
    }

    /** Records a step whose state is the given orbit, with a one second transition. */
    function recordStep(id: string, values: number[])
    {
        const start = orbit().value.slice();
        orbit().setValue(values);
        machine.setState({ id, values: machine.getCurrentValues(), curve: EEasingCurve.Linear, duration: 1, threshold: 0.5 });
        orbit().setValue(start);
    }

    beforeEach(function() {
        story = createStory(createDocumentData([ { name: "Model A" } ]));
        tours = story.document.setup.tours;
        machine = story.document.setup.snapshots;
        frames(2);

        orbit().setValue([ 10, 20, 0 ]);
        recordStep("s1", [ 42.1, -8.4, 0 ]);
        recordStep("s2", [ 3.3, 7.7, 0 ]);
        recordStep("s3", [ 3.3, 7.7, 0 ]); // doesn't move the camera from s2
        tours.fromData([{ title: "Tour", steps: [ { id: "s1", title: "1" }, { id: "s2", title: "2" }, { id: "s3", title: "3" } ] } as any]);
        frames(1);

        events = [];
        story.document.setup.viewer.rootElement.addEventListener("tour-step", (event: CustomEvent) => events.push(event.detail));
    });

    /** Enables tours and picks the tour, as the tour menu does. */
    function startTour()
    {
        tours.ins.enabled.setValue(true);
        frames(1);
        tours.ins.tourIndex.setValue(0);
    }

    describe("\"tour-step\" event", function() {
        it("fires once the transition to a step is complete", function() {
            startTour();
            frames(30);
            expect(events, "mid-transition").to.deep.equal([]);

            frames(40);
            expect(events).to.deep.equal([ { tour: 0, step: 0 } ]);
            expect(orbit().value).to.deep.equal([ 42.1, -8.4, 0 ]);
        });

        it("fires once per step", function() {
            startTour();
            frames(70);
            tours.ins.next.set();
            frames(70);
            tours.ins.next.set();
            frames(70);

            expect(events).to.deep.equal([ { tour: 0, step: 0 }, { tour: 0, step: 1 }, { tour: 0, step: 2 } ]);
        });

        it("fires for a step that doesn't change the view", function() {
            startTour();
            frames(70);
            tours.ins.next.set();
            frames(70);
            events.length = 0;

            tours.ins.next.set();
            frames(70);
            expect(events).to.deep.equal([ { tour: 0, step: 2 } ]);
        });

        it("fires right after an instant jump to a step", function() {
            startTour();
            frames(70);
            events.length = 0;

            tours.ins.stepIndex.setValue(1);
            frames(2);
            expect(events).to.deep.equal([ { tour: 0, step: 1 } ]);
            expect(orbit().value).to.deep.equal([ 3.3, 7.7, 0 ]);
        });

        it("only fires for the last step when a transition is interrupted", function() {
            startTour();
            frames(30);
            tours.ins.next.set();
            frames(70);

            expect(events).to.deep.equal([ { tour: 0, step: 1 } ]);
        });

        it("fires { tour: -1, step: -1 } once the view before the tour is restored", function() {
            startTour();
            frames(70);
            events.length = 0;

            tours.ins.enabled.setValue(false);
            frames(30);
            expect(events, "mid-transition").to.deep.equal([]);

            frames(40);
            expect(events).to.deep.equal([ { tour: -1, step: -1 } ]);
            expect(orbit().value).to.deep.equal([ 10, 20, 0 ]);
        });

        it("doesn't fire when the tour ends on the tour menu", function() {
            startTour();
            frames(70);
            tours.ins.stepIndex.setValue(2);
            frames(2);
            events.length = 0;

            tours.ins.next.set();
            frames(70);
            expect(tours.outs.tourIndex.value).to.equal(-1);
            expect(events).to.deep.equal([]);
        });

        it("doesn't fire for a step left before it was reached", function() {
            startTour();
            frames(30);
            tours.ins.enabled.setValue(false);
            frames(70);

            expect(events).to.deep.equal([ { tour: -1, step: -1 } ]);
        });
    });

    describe("getActiveTourStep()", function() {
        it("is null while tours are disabled", function() {
            expect(tours.getActiveTourStep()).to.be.null;
        });

        it("is null on the tour menu", function() {
            tours.ins.enabled.setValue(true);
            frames(2);
            expect(tours.getActiveTourStep()).to.be.null;
        });

        it("returns the step as soon as it is requested", function() {
            startTour();
            frames(1);
            expect(tours.getActiveTourStep()).to.deep.equal({ tour: 0, step: 0 });

            tours.ins.next.set();
            frames(1);
            expect(tours.getActiveTourStep()).to.deep.equal({ tour: 0, step: 1 });
        });

        it("is null after the last step", function() {
            startTour();
            frames(1);
            tours.ins.stepIndex.setValue(2);
            frames(1);
            tours.ins.next.set();
            frames(1);
            expect(tours.getActiveTourStep()).to.be.null;
        });

        it("is null once tours are disabled", function() {
            startTour();
            frames(70);
            tours.ins.enabled.setValue(false);
            frames(1);
            expect(tours.getActiveTourStep()).to.be.null;
        });
    });
});
