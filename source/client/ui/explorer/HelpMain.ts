/**
 * 3D Foundation Project
 * Copyright 2025 Smithsonian Institution
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { html } from "@ff/ui/CustomElement";
import { unsafeHTML } from "lit-html/directives/unsafe-html";

import "@ff/ui/Button";
import CVDocument from "client/components/CVDocument";
import { ELanguageType } from "client/schema/common";
import { openModal } from "../Modal";
import { IHelpCallout, IHelpCalloutSelectEvent } from "./HelpCallouts";
import "./HelpCallouts";

////////////////////////////////////////////////////////////////////////////////

/**
 * The introduction is shown pre-formatted, but may have paragraphs and headings
 * (see CollectionPanel.sanitizeIntro), which break lines already: drops a line break
 * typed next to them or after a <br>, else they'd add an empty line.
 */
export function preformatIntro(intro: string)
{
    return intro
        .replace(/(<\/(?:p|h[1-6])>|<br\s*\/?>)[ \t]*\r?\n/gi, "$1")
        .replace(/\r?\n[ \t]*(?=<(?:p|h[1-6])[\s>])/gi, "");
}

/** Callouts on the main menu's and bottom bar's buttons. */
const menuCallouts: IHelpCallout[] = [
    { selector: "#ar-btn", text: "Launch an augmented reality experience" },
    { selector: "#audio-btn", text: "Hear an audio narration of the scene" },
    { selector: "#tour-btn", text: "Take a curated guided tour of the scene" },
    { selector: "#reader-btn", text: "Read articles about the scene content" },
    { selector: "#anno-btn", text: "Show annotations highlighting key points" },
    { selector: "#share-btn", text: "Share the experience with a friend" },
    { selector: "#fullscreen-btn", text: "View the experience in fullscreen mode" },
    { selector: "#tools-btn", text: "Open the advanced tool menu" },
    // bottom bar, side by side: one bubble beside, the other above, so that none covers the other
    { selector: "#main-reset", text: "Reset the scene to its initial view", side: "left" },
    { selector: "#language", text: "Choose the language of the experience", side: "top" },
    // the button opening the introduction, back to it: no bubble, the language's is above
    { selector: "#main-help", text: "" },
];

/** Tutorial on navigating a scene, in French or else English. */
export function navigationTutorialUrl(language: ELanguageType)
{
    const code = language === ELanguageType.FR ? "fr" : "en";
    return `https://ecorpus.eu/${code}/doc/tutorials/navigation.html`;
}

/** What the help shows: the introduction's window, or callouts on the interface's buttons. */
export type THelpMode = "intro" | "callouts";

export interface IHelpOptions
{
    /** The introduction by default, the callouts if the scene has no introduction. */
    mode?: THelpMode;
}

/**
 * Shows the introduction to Voyager over the blurred scene. Either a window with the
 * scene's title, introduction and copyright notice, and a button showing the help instead:
 * callouts on the main menu's and bottom bar's buttons, and a window welcoming to Voyager,
 * linking to a tutorial on navigating the scene. The callout on the button opening the introduction goes back to it.
 * Follows the document's title, introduction, copyright and language while open: the
 * scene's language may only be set once the introduction is shown.
 * `parent` is the chrome view, where the buttons are looked up.
 * The other callouts stand for their buttons: clicking one closes the help, then focuses
 * and clicks the button, from the callout's click handler, so that the button's action
 * still counts as user-initiated (required for fullscreen and AR).
 * @returns the button clicked through a callout, if any, once closed.
 */
export function showHelp(parent: HTMLElement, document: CVDocument, options: IHelpOptions = {}): Promise<HTMLElement | undefined>
{
    const language = document.setup.language;
    const followed = [ document.outs.title, document.outs.intro, document.ins.copyright, language.outs.activeLanguage ];
    let mode: THelpMode = options.mode ?? "intro";
    let onChange: () => void;

    const closed = openModal<HTMLElement>(parent, ({ close, update }) => {
        if (!onChange) {
            onChange = update;
            followed.forEach(property => property.on("value", onChange));
        }

        const title = document.outs.title.value || "";
        const intro = document.outs.intro.value || "";
        const copyright = document.ins.copyright.value || "";
        const callouts = menuCallouts.map(callout => ({ ...callout, text: callout.text && language.getLocalizedString(callout.text) }));
        // without introduction, there's only the help
        const shown: THelpMode = intro ? mode : "callouts";

        /** Shows the introduction or the help, focusing it. */
        const show = (next: THelpMode, from: Element) => {
            mode = next;
            update();
            if (next === "intro") {
                const modal = from.closest("sv-modal") as any;
                modal?.updateComplete.then(() => (modal.querySelector(".sv-main-help") as HTMLElement)?.focus());
            }
        };

        const onSelect = (event: IHelpCalloutSelectEvent) => {
            const target = event.detail.target;
            if (target.id === "main-help") {
                intro ? show("intro", event.target as Element) : close();
                return;
            }
            // closing at once makes the menu usable again
            close(target);
            target.focus();
            target.click();
        };

        if (shown === "intro") {
            return html`<div class="sv-main-help" tabindex="-1" autofocus>
                <div class="ff-flex-row">
                    <div class="ff-flex-spacer ff-title" role="heading"><b>${unsafeHTML(title)}</b></div>
                    <ff-button icon="close" transparent class="ff-close-button" title=${language.getLocalizedString("Close")} @click=${() => close()}></ff-button>
                </div>
                <div class="sv-help-intro sv-preformatted">${unsafeHTML(preformatIntro(intro))}</div>
                <div class="sv-help-footer">
                    <ff-button icon="help" class="sv-help-show" text=${language.getLocalizedString("Show help")}
                        @click=${(event: Event) => show("callouts", event.target as Element)}></ff-button>
                    ${copyright ? html`<div class="sv-help-copyright">${unsafeHTML(copyright)}</div>` : null}
                </div>
            </div>`;
        }

        // the window had focus: moves it to the callouts
        return html`<sv-help-callouts .root=${parent} .callouts=${callouts} label=${language.getLocalizedString("Main toolbar")}
                focusFirst @select=${onSelect}></sv-help-callouts>
            <div class="sv-help-navigation-window">
                <div class="ff-title" role="heading"><b>${language.getLocalizedString("Welcome to Voyager")}</b></div>
                <p>${language.getLocalizedString("Drag to turn around the scene, scroll or pinch to zoom. The highlighted buttons open its features.")}</p>
                <div class="sv-help-tutorial">
                    <a href=${navigationTutorialUrl(language.outs.activeLanguage.value)} target="_blank" rel="noopener">${language.getLocalizedString("How to navigate the scene")}<span aria-hidden="true"> →</span><span class="sr-only"> (${language.getLocalizedString("opens in a new tab")})</span></a>
                </div>
            </div>`;
    }, { label: language.getLocalizedString("Introduction to Voyager"), panelClass: "sv-help-overlay" });

    return closed.finally(() => followed.forEach(property => property.off("value", onChange)));
}
