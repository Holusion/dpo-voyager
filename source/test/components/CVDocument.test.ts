import { expect } from "chai";

import { createDocumentData, createStory } from "../helpers/story";

describe("CVDocument", function() {

    describe("showIntro", function() {

        /** A story of a scene with the given meta collection. */
        function story(collection: any)
        {
            return createStory(createDocumentData([ { name: "Model" } ], [ { collection } ], 0));
        }

        /** The scene's meta collection, as saved. */
        const saved = (s: ReturnType<typeof story>) => s.document.deflateDocument().metas[0].collection;

        it("shows the introduction at load by default", function() {
            const s = story({ intros: { EN: "Hello" } });
            s.update();

            expect(s.document.ins.showIntro.value).to.equal(true);
            expect(saved(s)).to.not.have.property("showIntro");
        });

        it("is loaded from the scene's meta collection", function() {
            const s = story({ intros: { EN: "Hello" }, showIntro: false });
            s.update();

            expect(s.document.ins.showIntro.value).to.equal(false);
            expect(s.document.outs.intro.value, "the introduction is still there").to.equal("Hello");
        });

        it("is saved in the scene's meta collection when false only", function() {
            const s = story({ intros: { EN: "Hello" } });
            s.update();

            s.document.ins.showIntro.setValue(false);
            s.update();
            expect(saved(s).showIntro).to.equal(false);

            s.document.ins.showIntro.setValue(true);
            s.update();
            expect(saved(s)).to.not.have.property("showIntro");
        });

        it("survives saving and loading", function() {
            const s = story({ intros: { EN: "Hello" } });
            s.update();
            s.document.ins.showIntro.setValue(false);
            s.update();

            // the saved metas, the models having no geometry to save
            const reloaded = createStory(createDocumentData([ { name: "Model" } ], s.document.deflateDocument().metas, 0));
            reloaded.update();
            expect(reloaded.document.ins.showIntro.value).to.equal(false);
        });
    });
});
