import { expect } from "chai";

import { labelOf, valueOf } from "client/utils/describeEdit";

////////////////////////////////////////////////////////////////////////////////

/**
 * Stands in for a Property. describeEdit reads path, name, schema and the
 * component behind the group, and nothing else - which is what lets it be
 * tested without building a graph.
 */
function property(path: string, schema?: any, componentName?: string): any
{
    return {
        path,
        name: path.split(".").pop(),
        schema: schema || {},
        group: componentName === undefined ? null : { linkable: { displayName: componentName } },
    };
}

////////////////////////////////////////////////////////////////////////////////

describe("describeEdit labels", function() {

    it("puts the component in front of the property", function() {
        expect(labelOf(property("Floor.Opacity", {}, "Floor"))).to.equal("Floor opacity");
        expect(labelOf(property("Light.Intensity", {}, "Sunlight"))).to.equal("Sunlight intensity");
    });

    it("splits the words a property name runs together", function() {
        expect(labelOf(property("Material.BaseColor", {}, "Mausoleum"))).to.equal("Mausoleum base color");
        expect(labelOf(property("Camera.ViewPreset", {}, "Camera"))).to.equal("Camera view preset");
    });

    it("does not say the same word twice", function() {
        expect(labelOf(property("Scene.Units", {}, "Units"))).to.equal("Units");
    });

    it("falls back to the property alone with no component", function() {
        expect(labelOf(property("Floor.Opacity"))).to.equal("Opacity");
    });
});

describe("describeEdit values", function() {

    it("reads booleans as on and off", function() {
        const p = property("Grid.Visible", { preset: false });
        expect(valueOf(p, true)).to.equal("on");
        expect(valueOf(p, false)).to.equal("off");
    });

    it("reads an enum as the option that was picked", function() {
        const p = property("Slice.Axis", { preset: 0, options: [ "X", "Y", "Z" ] });
        expect(valueOf(p, 2)).to.equal("Z");
        // Out of range still has to say something.
        expect(valueOf(p, 9)).to.equal("X");
    });

    it("trims a float to digits a person can read", function() {
        const p = property("Reader.Position", { preset: 0 });
        expect(valueOf(p, 0.3333333333)).to.equal("0.333");
        expect(valueOf(p, 12)).to.equal("12");
    });

    it("reads a colour as hex", function() {
        const p = property("Background.Color0", { preset: [ 1, 1, 1 ], semantic: "color" });
        expect(valueOf(p, [ 1, 0, 0 ])).to.equal("#ff0000");
        expect(valueOf(p, [ 0, 0.5, 1 ])).to.equal("#0080ff");
    });

    it("brackets a vector", function() {
        const p = property("Transform.Position", { preset: [ 0, 0, 0 ] });
        expect(valueOf(p, [ 1, 2.5, -3 ])).to.equal("[1, 2.5, -3]");
    });

    it("quotes a string and cuts a long one short", function() {
        const p = property("Document.Title", { preset: "" });
        expect(valueOf(p, "Mausoleum")).to.equal('"Mausoleum"');
        expect(valueOf(p, "")).to.equal("empty");
        expect(valueOf(p, "x".repeat(40))).to.equal(`"${"x".repeat(31)}…"`);
    });

    it("says something for a value that is not there", function() {
        expect(valueOf(property("Model.Quality"), null)).to.equal("none");
        expect(valueOf(property("Model.Quality"), undefined)).to.equal("none");
    });
});
