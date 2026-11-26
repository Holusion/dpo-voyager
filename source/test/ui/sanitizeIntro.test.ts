import { expect } from "chai";

import { sanitizeIntro } from "client/ui/story/CollectionPanel";

describe("sanitizeIntro", function() {

    it("keeps paragraphs, line breaks, headings and text styles", function() {
        const intro = "<h2>Seclin</h2><p>La <b>collégiale</b>,<br />XI<sup>e</sup> <i>siècle</i></p><h6>Note</h6>";
        expect(sanitizeIntro(intro)).to.equal(intro);
    });

    it("keeps links, without scripts", function() {
        expect(sanitizeIntro(`<a href="https://ecorpus.eu" target="_blank">site</a>`))
            .to.equal(`<a href="https://ecorpus.eu" target="_blank">site</a>`);
        expect(sanitizeIntro(`<a href="javascript:alert(1)">x</a>`)).to.equal(`<a>x</a>`);
    });

    it("drops scripts, event handlers and other elements", function() {
        expect(sanitizeIntro(`<p onclick="alert(1)">a</p><script>alert(1)</script><img src=x onerror="alert(1)"><div>b</div>`))
            .to.equal(`<p>a</p>b`);
    });
});
