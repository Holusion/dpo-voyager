import { expect } from "chai";

import { labelOf, valueOf } from "client/utils/describeEdit";

////////////////////////////////////////////////////////////////////////////////

/**
 * Stands in for a Property. describeEdit reads path, name, schema and the
 * component behind the group, and nothing else - which is what lets it be
 * tested without building a graph.
 */
function property(path: string, schema?: any, component?: any): any
{
    return {
        path,
        name: path.split(".").pop(),
        schema: schema || {},
        group: component === undefined ? null : { linkable: component },
    };
}

/** Stands in for a Component: a display name, a static text, a type name. */
function comp(displayName: string, text?: string, typeName?: string): any
{
    return {
        displayName,
        text: text || "",
        typeName: typeName || "",
        displayTypeName: typeName ? typeName.substr(1) : "",
    };
}

////////////////////////////////////////////////////////////////////////////////

describe("describeEdit labels", function() {

    it("puts the component in front of the property", function() {
        expect(labelOf(property("Floor.Opacity", {}, comp("Floor")))).to.equal("Floor opacity");
        expect(labelOf(property("Light.Intensity", {}, comp("Sunlight")))).to.equal("Sunlight intensity");
    });

    it("splits the words a property name runs together", function() {
        expect(labelOf(property("Material.BaseColor", {}, comp("Mausoleum")))).to.equal("Mausoleum material base color");
        expect(labelOf(property("Camera.ViewPreset", {}, comp("Camera")))).to.equal("Camera view preset");
    });

    it("keeps a group that names a facet of a bigger component", function() {
        expect(labelOf(property("Annotations.Visible", {}, comp("Viewer")))).to.equal("Viewer annotations visible");
        expect(labelOf(property("Shadow.Blur", {}, comp("Directional Light")))).to.equal("Directional Light shadow blur");
    });

    it("drops a group that repeats the component or names a base class", function() {
        expect(labelOf(property("Floor.Opacity", {}, comp("Floor")))).to.equal("Floor opacity");
        expect(labelOf(property("Slice.Enabled", {}, comp("Slicer")))).to.equal("Slicer enabled");
        expect(labelOf(property("Object.Visible", {}, comp("Grid")))).to.equal("Grid visible");
    });

    it("does not name a document after the file it came from", function() {
        const document = comp("scene.svx.json", "", "CVDocument");
        expect(labelOf(property("Document.Title", {}, document))).to.equal("Document title");
    });

    it("recovers a type name the library's fallback mangles", function() {
        // displayTypeName drops one character, which leaves the V on CV*.
        const background = comp("VBackground", "", "CVBackground");
        expect(labelOf(property("Background.Color0", {}, background))).to.equal("Background color0");
    });

    it("falls back to the property alone with no component", function() {
        expect(labelOf(property("Floor.Opacity"))).to.equal("Floor opacity");
        expect(labelOf(property("Renderer.Exposure"))).to.equal("Renderer exposure");
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
