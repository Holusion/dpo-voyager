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

import CustomElement, { customElement, property, html } from "@ff/ui/CustomElement";

////////////////////////////////////////////////////////////////////////////////

@customElement("sv-spinner")
export default class Spinner extends CustomElement
{
    @property({ type: Boolean })
    visible = false;

    @property({ type: String })
    assetPath = "";

    protected static readonly template = html`<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.2-8.6" fill="none" stroke="#e6b900" stroke-width="2" stroke-linecap="round"/></svg>`;

    protected firstConnected()
    {
        super.firstConnected();
        this.classList.add("sv-spinner");
    }

    protected render()
    {
        this.style.visibility = this.visible ? "visible" : "hidden";

        // A page that has a loader of its own, as eCorpus has <cube-loader> (drawn and styled by itself), gets it here too
        if (window.customElements.get("cube-loader")) {
            return html`<cube-loader class="sv-spinner-cube"></cube-loader>`;
        }

        const spinner = html`<div class="sv-spinner-wheel"><object data="${this.assetPath}images/spinner.svg" type="image/svg+xml" alt="Spinner">
            ${Spinner.template}
        </object></div>`;

        return spinner;
    }
}