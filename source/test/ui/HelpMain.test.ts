import { expect } from "chai";

import Modal from "client/ui/Modal";
import { showHelp } from "client/ui/explorer/HelpMain";
import { ENavigationType } from "client/schema/setup";

const nextFrame = () => new Promise(resolve => setTimeout(resolve, 0));

/** Waits until `check` returns true, callouts being laid out on an animation frame. */
async function until(check: () => boolean, timeout = 1000)
{
    const start = Date.now();
    while (!check() && Date.now() - start < timeout) {
        await new Promise(resolve => setTimeout(resolve, 5));
    }
}

/** A document property: its value, and listeners of its changes. */
function property(value: any)
{
    const listeners = new Set<() => void>();
    return {
        value,
        listeners,
        on: (type: string, listener: () => void) => listeners.add(listener),
        off: (type: string, listener: () => void) => listeners.delete(listener),
        setValue(value: any) { this.value = value; listeners.forEach(listener => listener()); },
    };
}

/** The parts of a CVDocument the help uses. */
function fakeDocument({ navMode = ENavigationType.Orbit } = {})
{
    const language = { getLocalizedString: (text: string) => text, outs: { activeLanguage: property(0) } };
    const navigation = { ins: { mode: { value: navMode } } };
    return { setup: { language, navigation } };
}

describe("showHelp", function() {

    // stands for the chrome view, where the menu buttons are
    let parent: HTMLElement;

    beforeEach(function() {
        parent = document.createElement("div");
        document.body.append(parent);
    });

    afterEach(function() {
        document.querySelectorAll("sv-modal").forEach(modal => modal.remove());
        parent.remove();
    });

    /** A menu button, with a box: happy-dom doesn't lay out. */
    function menuButton(id: string, top: number)
    {
        const button = document.createElement("button");
        button.id = id;
        button.title = id;
        button.getBoundingClientRect = () => new DOMRect(6, top, 38, 38);
        parent.append(button);
        return button;
    }

    async function open(options?: { navMode?: ENavigationType })
    {
        const doc = fakeDocument(options);
        const closed = showHelp(parent, doc as any);
        await nextFrame();
        const modal = document.querySelector("sv-modal") as Modal;
        const window = modal.querySelector(".sv-main-help") as HTMLElement;
        const callouts = () => Array.from(modal.querySelectorAll(".sv-help-callout")).map(callout => callout.textContent.trim());
        const ring = (id: string) => modal.querySelector(`.sv-help-callout-ring[aria-label="${id}"]`) as HTMLButtonElement;
        return { doc, modal, window, callouts, ring, closed, close: () => { modal.close(); return closed; } };
    }

    it("shows the navigation controls side by side in a window", async function() {
        const { modal, window, close } = await open();

        expect(Array.from(window.querySelectorAll(".sv-help-nav h3")).map(title => title.textContent.trim()))
            .to.deep.equal([ "Orbit", "Pan", "Zoom" ]);
        // dialog.show() focuses it in browsers (happy-dom doesn't)
        expect(Array.from(modal.querySelectorAll("[autofocus]")), "autofocus on the window").to.deep.equal([window]);
        await close();
    });

    it("names the navigation controls after the navigation mode", async function() {
        const { window, close } = await open({ navMode: ENavigationType.Walk });

        expect(Array.from(window.querySelectorAll(".sv-help-nav h3")).map(title => title.textContent.trim()))
            .to.deep.equal([ "Look Around", "Pan", "Forward/Backward" ]);
        await close();
    });

    it("closes from the callout on the help button, without clicking it", async function() {
        const help = menuButton("main-help", 700);
        let clicks = 0;
        help.addEventListener("click", () => clicks++);

        const { doc, modal, ring, closed } = await open();
        await until(() => !!ring("main-help"));
        expect(modal.querySelector(".sv-help-callout-bubble"), "no bubble").to.equal(null);

        ring("main-help").click();
        // a CustomEvent's undefined detail is null
        expect(await closed, "nothing clicked").to.not.be.ok;
        expect(modal.isConnected).to.equal(false);
        expect(clicks).to.equal(0);
        expect(doc.setup.language.outs.activeLanguage.listeners.size, "listeners once closed").to.equal(0);
    });

    it("has a callout for each menu button there is", async function() {
        menuButton("tour-btn", 6);
        menuButton("share-btn", 50);
        const { callouts, close } = await open();

        await until(() => callouts().length > 0);
        expect(callouts()).to.deep.equal([
            "Take a curated guided tour of the scene",
            "Share the experience with a friend",
        ]);
        await close();
    });

    it("follows menu buttons appearing after it opened", async function() {
        menuButton("share-btn", 50);
        const { callouts, close } = await open();
        await until(() => callouts().length > 0);
        expect(callouts()).to.have.length(1);

        menuButton("ar-btn", 6);
        await until(() => callouts().length > 1);
        expect(callouts()).to.deep.equal([
            "Launch an augmented reality experience",
            "Share the experience with a friend",
        ]);
        await close();
    });

    it("clicks a menu button through its callout, and closes", async function() {
        const share = menuButton("share-btn", 50);
        let clicks = 0;
        share.addEventListener("click", () => clicks++);

        const { modal, ring, closed } = await open();
        await until(() => !!ring("share-btn"));
        ring("share-btn").click();
        // within the callout's click handler, for fullscreen and AR
        expect(clicks, "clicked at once").to.equal(1);

        expect(await closed, "resolves with the button").to.equal(share);
        expect(modal.isConnected, "closed").to.equal(false);
        expect(document.activeElement, "focus on the button").to.equal(share);
    });

    it("leaves focus to what the menu button opened", async function() {
        const share = menuButton("share-btn", 50);
        const opened = document.createElement("input");
        share.addEventListener("click", () => {
            // what the button opens takes focus
            document.body.append(opened);
            opened.focus();
        });

        const { ring, closed } = await open();
        await until(() => !!ring("share-btn"));
        ring("share-btn").click();
        await closed;
        await nextFrame();

        expect(document.activeElement).to.equal(opened);
        opened.remove();
    });

    it("doesn't click disabled menu buttons", async function() {
        const tools = menuButton("tools-btn", 6);
        (tools as any).disabled = true;
        let clicks = 0;
        tools.addEventListener("click", () => clicks++);

        const { modal, ring, close } = await open();
        await until(() => !!ring("tools-btn"));
        expect(ring("tools-btn").disabled).to.equal(true);
        ring("tools-btn").click();
        await nextFrame();

        expect(modal.isConnected, "still open").to.equal(true);
        expect(clicks).to.equal(0);
        await close();
    });

    it("doesn't click menu buttons through the callouts' text, nor close", async function() {
        const share = menuButton("share-btn", 50);
        let clicks = 0;
        share.addEventListener("click", () => clicks++);

        const { modal, ring, close } = await open();
        await until(() => !!ring("share-btn"));
        (modal.querySelector(".sv-help-callout-bubble") as HTMLElement).click();
        await nextFrame();

        expect(clicks).to.equal(0);
        expect(modal.isConnected, "still open").to.equal(true);
        await close();
    });

    it("makes the callouts buttons named after their menu button, described by their text", async function() {
        const share = menuButton("share-btn", 50);
        share.title = "Share Experience";

        const { modal, close } = await open();
        await until(() => !!modal.querySelector(".sv-help-callout-ring"));

        const list = modal.querySelector("sv-help-callouts");
        expect(list.getAttribute("role")).to.equal("list");
        expect(list.getAttribute("aria-label")).to.equal("Main toolbar");

        const ring = modal.querySelector(".sv-help-callout-ring") as HTMLButtonElement;
        expect(ring.tagName, "reachable by keyboard").to.equal("BUTTON");
        expect(ring.getAttribute("aria-label")).to.equal("Share Experience");
        const description = modal.querySelector("#" + ring.getAttribute("aria-describedby"));
        expect(description?.textContent).to.equal("Share the experience with a friend");
        await close();
    });

    it("has callouts on the bottom bar's reset and language buttons, beside and above", async function() {
        const reset = menuButton("main-reset", 700);
        const lang = menuButton("language", 700);
        reset.getBoundingClientRect = () => new DOMRect(1140, 756, 38, 38);
        lang.getBoundingClientRect = () => new DOMRect(1190, 756, 38, 38);

        const { modal, callouts, close } = await open();
        await until(() => callouts().length === 2);

        const [ resetCallout, langCallout ] = Array.from(modal.querySelectorAll(".sv-help-callout"));
        expect(resetCallout.textContent.trim()).to.equal("Reset the scene to its initial view");
        expect(resetCallout.classList.contains("sv-help-callout-left")).to.equal(true);
        expect(langCallout.textContent.trim()).to.equal("Choose the language of the experience");
        expect(langCallout.classList.contains("sv-help-callout-top")).to.equal(true);
        await close();
    });
});
