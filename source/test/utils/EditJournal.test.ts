import { expect } from "chai";

import EditJournal, { IJournalNaming, IJournalTarget, valuesEqual } from "client/utils/EditJournal";

////////////////////////////////////////////////////////////////////////////////

/** Stands in for a Property: the journal only ever clones and writes values. */
class Target implements IJournalTarget
{
    value: any;

    constructor(readonly path: string, value: any)
    {
        this.value = value;
    }

    cloneValue() {
        return Array.isArray(this.value) ? this.value.slice() : this.value;
    }

    copyValue(value: any) {
        this.value = Array.isArray(value) ? value.slice() : value;
    }
}

/** Records a change to a target the way CVSaveState does, and applies it. */
function edit(journal: EditJournal, target: Target, value: any, time: number)
{
    const before = target.cloneValue();
    target.copyValue(value);
    journal.record(target, before, target.cloneValue(), time);
}

const window = EditJournal.coalesceWindow;

/** Naming that spells out a target the way the story tool's would. */
const naming: IJournalNaming = {
    label: target => target.path.split(".").pop(),
    value: (target, value) => JSON.stringify(value),
};

////////////////////////////////////////////////////////////////////////////////

describe("valuesEqual", function() {
    it("compares scalars and arrays by value", function() {
        expect(valuesEqual(1, 1)).to.be.true;
        expect(valuesEqual("a", "b")).to.be.false;
        expect(valuesEqual([1, 2, 3], [1, 2, 3])).to.be.true;
        expect(valuesEqual([1, 2, 3], [1, 2, 4])).to.be.false;
        expect(valuesEqual([1, 2], [1, 2, 3])).to.be.false;
    });
    it("treats NaN as equal to itself", function() {
        // Written by more than one property in this tree; unequal would journal
        // an edit every frame.
        expect(valuesEqual(NaN, NaN)).to.be.true;
    });
});

describe("EditJournal", function() {

    it("undoes and redoes a change", function() {
        const journal = new EditJournal();
        const colour = new Target("Background.Color0", [0, 0, 0]);

        edit(journal, colour, [1, 0, 0], 0);
        expect(colour.value).to.deep.equal([1, 0, 0]);

        expect(journal.undo()).to.not.be.null;
        expect(colour.value).to.deep.equal([0, 0, 0]);

        expect(journal.redo()).to.not.be.null;
        expect(colour.value).to.deep.equal([1, 0, 0]);
    });

    it("does not hand out the values it is holding", function() {
        // PropertyField writes through property.value in place, so a record
        // that shared an array with the property would be rewritten by the
        // next edit to it.
        const journal = new EditJournal();
        const position = new Target("Model.Position", [0, 0, 0]);

        edit(journal, position, [1, 2, 3], 0);
        position.value[0] = 99;

        journal.undo();
        expect(position.value).to.deep.equal([0, 0, 0]);
    });

    it("is dirty exactly when the pointer is off the save point", function() {
        const journal = new EditJournal();
        const title = new Target("Document.Title", "before");

        expect(journal.isDirty).to.be.false;

        edit(journal, title, "after", 0);
        expect(journal.isDirty).to.be.true;

        journal.undo();
        expect(journal.isDirty).to.be.false;   // the flag alone cannot do this

        journal.redo();
        expect(journal.isDirty).to.be.true;

        journal.markSaved();
        expect(journal.isDirty).to.be.false;

        journal.undo();
        expect(journal.isDirty).to.be.true;
    });

    it("coalesces changes that arrive together", function() {
        const journal = new EditJournal();
        const a = new Target("A", 0);
        const b = new Target("B", 0);

        // one gesture: an edit and the write it cascades into
        edit(journal, a, 1, 0);
        edit(journal, b, 1, 10);
        expect(journal.length).to.equal(1);

        journal.undo();
        expect(a.value).to.equal(0);
        expect(b.value).to.equal(0);
    });

    it("starts a new entry after a gap", function() {
        const journal = new EditJournal();
        const a = new Target("A", 0);

        edit(journal, a, 1, 0);
        edit(journal, a, 2, window + 1);
        expect(journal.length).to.equal(2);

        journal.undo();
        expect(a.value).to.equal(1);
    });

    it("starts a new entry after commit(), however quick", function() {
        const journal = new EditJournal();
        const a = new Target("A", 0);

        edit(journal, a, 1, 0);
        journal.commit();
        edit(journal, a, 2, 1);

        expect(journal.length).to.equal(2);
        journal.undo();
        expect(a.value).to.equal(1);
    });

    it("keeps the first value when a property changes twice in one entry", function() {
        const journal = new EditJournal();
        const a = new Target("Slider", 0);

        // a drag: sixty writes, one undo step, back to where it started
        for (let i = 1; i <= 60; ++i) {
            edit(journal, a, i, i);
        }

        expect(journal.length).to.equal(1);
        journal.undo();
        expect(a.value).to.equal(0);
    });

    it("names an entry after the property it started from", function() {
        const journal = new EditJournal();
        edit(journal, new Target("Renderer.Shader", 0), 1, 0);
        expect(journal.undoName).to.equal("Renderer.Shader");

        edit(journal, new Target("Material.Shader", 0), 1, 1);
        expect(journal.undoName).to.equal("Renderer.Shader +1");
    });

    it("drops the redo tail on a new edit", function() {
        const journal = new EditJournal();
        const a = new Target("A", 0);

        edit(journal, a, 1, 0);
        journal.commit();
        edit(journal, a, 2, window * 2);
        journal.undo();
        expect(journal.canRedo).to.be.true;

        edit(journal, a, 3, window * 4);
        expect(journal.canRedo).to.be.false;
        expect(journal.length).to.equal(2);
    });

    it("stays dirty when the save point is dropped with the redo tail", function() {
        const journal = new EditJournal();
        const a = new Target("A", 0);

        edit(journal, a, 1, 0);
        journal.markSaved();               // saved with one entry on the stack
        journal.undo();                    // and then stepped back off it
        expect(journal.isDirty).to.be.true;

        edit(journal, a, 2, window * 2);   // the save point is now unreachable
        expect(journal.isDirty).to.be.true;
        journal.undo();
        expect(journal.isDirty).to.be.true;
    });

    it("stays dirty when the save point falls off the bottom", function() {
        const journal = new EditJournal(3);
        const a = new Target("A", 0);

        journal.markSaved();
        for (let i = 1; i <= 4; ++i) {
            edit(journal, a, i, i * window * 2);
        }

        expect(journal.length).to.equal(3);
        while (journal.canUndo) {
            journal.undo();
        }
        expect(journal.isDirty).to.be.true;
    });

    it("forgets everything on clear()", function() {
        const journal = new EditJournal();
        edit(journal, new Target("A", 0), 1, 0);

        journal.clear();
        expect(journal.length).to.equal(0);
        expect(journal.canUndo).to.be.false;
        expect(journal.isDirty).to.be.false;
    });
});

describe("EditJournal titles", function() {

    it("says what the change moved, and where from", function() {
        const journal = new EditJournal(undefined, naming);
        const opacity = new Target("Floor.Opacity", 0.9);

        edit(journal, opacity, 0.25, 0);

        expect(journal.log[0].title).to.equal("Opacity from 0.9 to 0.25");
    });

    it("reads an undo in the direction the press moves it", function() {
        const journal = new EditJournal(undefined, naming);
        const opacity = new Target("Floor.Opacity", 0.9);

        edit(journal, opacity, 0.25, 0);

        expect(journal.undoTitle).to.equal("Opacity from 0.25 to 0.9");
        expect(journal.redoTitle).to.be.null;

        journal.undo();

        expect(journal.undoTitle).to.be.null;
        expect(journal.redoTitle).to.equal("Opacity from 0.9 to 0.25");
    });

    it("keeps up as an entry absorbs more of the same drag", function() {
        const journal = new EditJournal(undefined, naming);
        const opacity = new Target("Floor.Opacity", 0.9);

        edit(journal, opacity, 0.5, 0);
        edit(journal, opacity, 0.25, 10);

        // One entry, and it reads from where the drag started to where it is.
        expect(journal.length).to.equal(1);
        expect(journal.log[0].title).to.equal("Opacity from 0.9 to 0.25");
    });

    it("names the change it started from and counts the rest", function() {
        const journal = new EditJournal(undefined, naming);
        const enabled = new Target("Tape.Enabled", false);
        const visible = new Target("Tape.Visible", false);

        edit(journal, enabled, true, 0);
        edit(journal, visible, true, 10);

        expect(journal.log[0].title).to.equal("Enabled from false to true and 1 more change");
    });

    it("falls back to paths and raw values with no naming", function() {
        const journal = new EditJournal();
        const opacity = new Target("Floor.Opacity", 0.9);

        edit(journal, opacity, 0.25, 0);

        expect(journal.log[0].title).to.equal("Floor.Opacity from 0.9 to 0.25");
    });
});
