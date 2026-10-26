/**
 * 3D Foundation Project
 * Copyright 2026 Smithsonian Institution
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

import System from "@ff/graph/System";
import CustomElement, { customElement, html } from "@ff/ui/CustomElement";
import "@ff/ui/Button";

import CVLanguageManager from "../../components/CVLanguageManager";
import CVStoryApplication, { ESaveState } from "../../components/CVStoryApplication";

////////////////////////////////////////////////////////////////////////////////

/**
 * Covers the whole interface while a save runs, and makes the rest of it inert, so nothing can change or be
 * started meanwhile. It only shows once the save has lasted a moment (see styles.scss). Its close button cancels
 * the save.
 */
@customElement("sv-save-overlay")
export default class SaveOverlay extends CustomElement
{
    protected story: CVStoryApplication;
    protected language: CVLanguageManager;

    private held: Element[] = [];
    private focused: HTMLElement = null;

    constructor(system: System)
    {
        super();
        this.story = system.getMainComponent(CVStoryApplication);
        this.language = system.getComponent(CVLanguageManager);
    }

    protected firstConnected()
    {
        this.classList.add("sv-save-overlay");
    }

    protected connected()
    {
        this.story.outs.saveState.on("value", this.onSaveState, this);
        this.onSaveState();
    }

    protected disconnected()
    {
        this.story.outs.saveState.off("value", this.onSaveState, this);
        this.release();
    }

    protected onSaveState()
    {
        const saving = this.story.outs.saveState.value === ESaveState.Saving;
        // Render first: holding focuses the dialog once it exists.
        this.classList.toggle("sv-active", saving);
        this.requestUpdate();
        if (saving) {
            this.hold();
        }
        else {
            this.release();
        }
    }

    protected hold()
    {
        if (this.held.length) {
            return;
        }
        const focused = document.activeElement;
        this.focused = focused instanceof HTMLElement ? focused : null;
        // Inert takes pointer, keyboard and assistive access away; only what it newly holds is released after.
        this.held = Array.from(this.parentElement?.children || []).filter(element => element !== this && !element.hasAttribute("inert"));
        this.held.forEach(element => element.setAttribute("inert", ""));

        this.updateComplete.then(() => (this.querySelector(".sv-save-dialog") as HTMLElement)?.focus());
    }

    protected release()
    {
        if (!this.held.length) {
            return;
        }
        this.held.forEach(element => element.removeAttribute("inert"));
        this.held = [];

        const focused = this.focused;
        this.focused = null;
        if (focused?.isConnected && !focused.closest("[inert]")) {
            focused.focus();
        }
    }

    protected render()
    {
        if (this.story.outs.saveState.value !== ESaveState.Saving) {
            return html``;
        }

        const text = (s: string) => this.language.getUILocalizedString(s);
        const cancelling = this.story.isCancellingSave;
        const status = text(cancelling ? "Cancelling…" : this.story.isStandalone ? "Preparing download…" : "Saving…");

        return html`<div class="sv-save-dialog" role="alertdialog" aria-modal="true" aria-label=${status} tabindex="-1">
            <div class="sv-save-spinner" aria-hidden="true"></div>
            <div class="ff-text" role="status">${status}</div>
            ${cancelling ? null : html`<ff-button class="sv-save-cancel" inline icon="close"
                title=${text("Cancel save")} aria-label=${text("Cancel save")} @click=${this.onClickCancel}></ff-button>`}
        </div>`;
    }

    protected onClickCancel()
    {
        this.story.cancelSave();
        this.requestUpdate();
        this.updateComplete.then(() => (this.querySelector(".sv-save-dialog") as HTMLElement)?.focus());
    }
}
