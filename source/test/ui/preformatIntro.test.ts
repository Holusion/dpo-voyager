import { expect } from "chai";

import { preformatIntro } from "client/ui/explorer/SplashScreen";

describe("preformatIntro", function() {

    it("keeps the line breaks typed in text", function() {
        expect(preformatIntro("Une <b>collégiale</b>\nromane\n\nau XIe siècle")).to.equal("Une <b>collégiale</b>\nromane\n\nau XIe siècle");
    });

    it("drops one line break next to paragraphs and headings, which break lines already", function() {
        expect(preformatIntro("<h2>Seclin</h2>\nUne collégiale\n<p>romane</p>\r\n<p>au XIe</p>"))
            .to.equal("<h2>Seclin</h2>Une collégiale<p>romane</p><p>au XIe</p>");
        expect(preformatIntro("<h2>Seclin</h2>\n\nUne collégiale"), "an empty line typed is kept").to.equal("<h2>Seclin</h2>\nUne collégiale");
    });

    it("drops a line break typed after a <br>", function() {
        expect(preformatIntro("Une<br>\ncollégiale<br />\nromane")).to.equal("Une<br>collégiale<br />romane");
    });
});
