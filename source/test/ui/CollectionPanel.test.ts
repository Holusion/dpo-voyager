import { expect } from "chai";

import "@ff/ui/Button";
import "@ff/ui/LineEdit";
import CollectionPanel from "client/ui/story/CollectionPanel";

import { createStory, createDocumentData, IStory } from "../helpers/story";

describe("CollectionPanel", function() {

    let story: IStory, panel: CollectionPanel;

    /** Shows the panel for a scene with the given meta collection. */
    async function show(collection: any)
    {
        story = createStory(createDocumentData([ { name: "Model" } ], [ { collection } ], 0));
        story.update();
        panel = new CollectionPanel(story.system);
        document.body.append(panel);
        await panel.updateComplete;
    }

    const field = (id: string) => panel.querySelector(`[name="${id}"]`) as HTMLElement;
    const collection = () => story.document.meta.collection;

    /** What the line edit dispatches when its text is committed, as when it loses focus. */
    const commit = (id: string, text: string) =>
        field(id).dispatchEvent(new CustomEvent("change", { detail: { text, isEditing: false } }));

    afterEach(function() {
        panel?.remove();
    });

    it("shows a boolean custom meta as an on/off switch", async function() {
        await show({ flag: false });

        const toggle = field("flag");
        expect(toggle.tagName).to.equal("FF-BUTTON");
        expect(toggle.getAttribute("role")).to.equal("switch");
        expect(toggle.getAttribute("aria-checked")).to.equal("false");

        toggle.click();
        await panel.updateComplete;
        expect(collection().get("flag"), "still a boolean").to.equal(true);
        expect(field("flag").getAttribute("aria-checked")).to.equal("true");
    });

    it("shows other custom metas as text fields", async function() {
        await show({ note: "text", count: 3, empty: null });

        for (const id of [ "note", "count", "empty" ]) {
            expect(field(id).tagName, id).to.equal("FF-LINE-EDIT");
        }
        expect((field("empty") as any).text).to.equal("");

        commit("note", "other text");
        expect(collection().get("note")).to.equal("other text");
    });

    it("leaves a custom meta as it was when its text field loses focus unchanged", async function() {
        await show({ count: 3, empty: null });

        commit("count", "3");
        commit("empty", "");
        expect(collection().get("count")).to.equal(3);
        expect(collection().get("empty")).to.equal(null);

        commit("count", "4");
        expect(collection().get("count"), "edited: text").to.equal("4");
    });
});
