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

import Popup, { customElement, html } from "@ff/ui/Popup";

import "@ff/ui/Button";
import "@ff/ui/TextEdit";
import CVLanguageManager from "client/components/CVLanguageManager";
import { EDerivativeQuality, TDerivativeQuality } from "client/schema/model";
import CVModel2 from "client/components/CVModel2";
import Notification from "@ff/ui/Notification";
import CVImagePlane from "client/components/CVImagePlane";
import { IModelUploadProgress } from "client/io/ModelUploader";

import "../Spinner";

////////////////////////////////////////////////////////////////////////////////

/**
 * Uploads the file once a quality is chosen, and resolves with the uri of the model to load.
 * The menu stays open, busy, until it settles. Closing the menu aborts the signal.
 */
export type ImportMenuUpload = (quality: EDerivativeQuality, signal: AbortSignal, onProgress: (progress: IModelUploadProgress) => void) => Promise<string>;

////////////////////////////////////////////////////////////////////////////////

@customElement("sv-import-menu")
export default class ImportMenu extends Popup
{
    protected url: string;
    protected language: CVLanguageManager = null;
    protected filename: string = "";
    protected errorString: string = "";
    protected modelOptions: {name: string, id: string}[] = [];
    protected qualitySelection: EDerivativeQuality = null;
    protected parentSelection: {name: string, id: string} = null;

    protected upload: ImportMenuUpload = null;
    protected uploadController: AbortController = null;
    protected progress: IModelUploadProgress = null;
    protected uri: string = undefined;

    protected get busy() {
        return this.uploadController !== null;
    }

    /**
     * Resolves with the chosen quality and parent model name.
     * With an `upload`, the file is uploaded once they are chosen: the uri it resolves with comes third.
     * Rejects when the menu is closed.
     */
    static show(parent: HTMLElement, language: CVLanguageManager, filename: string, upload?: ImportMenuUpload): Promise<[EDerivativeQuality, string, string?]>
    {
        const menu = new ImportMenu(language, filename, upload);
        parent.appendChild(menu);

        return new Promise((resolve, reject) => {
            menu.on("confirm", () => resolve([menu.qualitySelection, menu.parentSelection.name, menu.uri]));
            menu.on("close", () => reject());
        });
    }

    constructor( language: CVLanguageManager, filename: string, upload?: ImportMenuUpload )
    {
        super();

        this.language = language;
        this.filename = filename;
        this.upload = upload ?? null;
        this.modelOptions = this.modelOptions.concat(language.getGraphComponents(CVModel2).filter(model => !model.is(CVImagePlane)).map(model => ({name: model.node.name, id: model.id})));
        this.position = "center";
        this.modal = true;
        this.parentSelection = this.modelOptions.length > 0 ? this.modelOptions[0] : {name: "Model"+this.modelOptions.length.toString(), id: "-1"};

        this.url = window.location.href;
    }

    close()
    {
        this.uploadController?.abort();
        this.dispatchEvent(new CustomEvent("close"));
        this.remove();
    }

    confirm()
    {
        if(this.busy) {
            return;
        }
        if(this.qualitySelection === null) {
            this.errorString = this.language.getUILocalizedString("Please select derivative quality.");
            this.requestUpdate();
        }
        else if(this.upload) {
            this.startUpload();
        }
        else {
            this.dispatchEvent(new CustomEvent("confirm"));
            this.remove();
        }
    }

    protected startUpload()
    {
        const controller = this.uploadController = new AbortController();
        this.errorString = "";
        this.progress = null;
        this.requestUpdate();

        const onProgress = (progress: IModelUploadProgress) => {
            if(controller.signal.aborted) return;
            this.progress = progress;
            this.requestUpdate();
        };

        Promise.resolve()
        .then(() => this.upload(this.qualitySelection, controller.signal, onProgress))
        .then(uri => {
            // Closed while uploading: close() already rejected
            if(controller.signal.aborted) return;
            this.uri = uri;
            this.dispatchEvent(new CustomEvent("confirm"));
            this.remove();
        }, error => {
            if(controller.signal.aborted) return;
            console.error("Model upload failed:", error);
            this.uploadController = null;
            this.progress = null;
            this.errorString = error?.message || this.language.getUILocalizedString("Upload failed");
            this.requestUpdate();
        });
    }

    protected firstConnected()
    {
        super.firstConnected();
        this.classList.add("sv-option-menu", "sv-import-menu");
    }

    protected renderQualityEntry(quality: EDerivativeQuality, index: number)
    {
        return html`<div class="sv-entry" @click=${e => this.onClickQuality(e, index)} ?selected=${ quality === this.qualitySelection }>
            ${EDerivativeQuality[quality] as TDerivativeQuality}
        </div>`;
    }

    protected renderUploadStatus()
    {
        const language = this.language;
        const { phase = "upload", loaded, total } = this.progress ?? {};
        const measured = phase === "upload" && typeof loaded === "number" && 0 < total;
        const status = phase === "process" ? language.getUILocalizedString("Processing...")
            : language.getUILocalizedString("Uploading...") + (measured ? ` ${Math.floor(100 * loaded / total)}%` : "");

        return html`<div class="sv-import-busy" role="status" aria-live="polite">
            <sv-spinner visible></sv-spinner>
            <div class="sv-import-status">
                <div>${status}</div>
                ${measured ? html`<progress max=${total} .value=${loaded}></progress>` : null}
            </div>
        </div>`;
    }

    protected renderParentEntry(option: string, index: number)
    {
        return html`<div class="sv-entry" @click=${e => this.onClickParent(e, index)} ?selected=${ option === this.parentSelection.name }>
            ${option}
        </div>`;
    }

    protected render()
    {
        const language = this.language;

        return html`
        <div>
            <div class="ff-flex-column ff-fullsize">
                ${this.busy ? this.renderUploadStatus() : null}
                <div class="ff-flex-row sv-import-title">
                    <div class="ff-flex-spacer ff-title">${language.getUILocalizedString("File:")} <i>${this.filename}</i></div>
                    <ff-button icon="close" transparent class="ff-close-button" title=${language.getUILocalizedString("Close")} @click=${this.close}></ff-button>
                </div>
                <div class="ff-flex-row">
                    <div class="ff-flex-spacer ff-header">${language.getUILocalizedString("Select Derivative Quality:")}</div>
                </div>
                <div class="ff-splitter-section" style="flex-basis: 70%">
                    <div class="ff-scroll-y">
                        ${Object.keys(EDerivativeQuality).filter(key => typeof EDerivativeQuality[key] === 'number').map((key, index) => this.renderQualityEntry(EDerivativeQuality[key], index))}
                    </div>
                </div>
                <div class="ff-flex-row">
                    <div class="ff-flex-spacer ff-header">${language.getUILocalizedString("Select Model:")}</div>
                </div>
                <div class="ff-splitter-section" style="flex-basis: 30%">
                    ${this.modelOptions.length > 0 ? html`<div class="ff-scroll-y">
                        ${this.modelOptions.map((option, index) => this.renderParentEntry(option.name, index))}
                    </div>` : html`<div class="ff-flex-row sv-centered sv-notification" style="height:100%; align-items:center">${language.getUILocalizedString("No Models In Scene")}</div>`}
                </div>
                <div class="sv-entry" @click=${e => this.onClickParent(e, -1)} ?selected=${ "-1" === this.parentSelection.id }>
                    <div class="ff-flex-row">
                        <label class="ff-label ff-off">${language.getUILocalizedString("Add New Model")}:</label>
                        <div class="ff-flex-spacer"></div>
                        <input id="modelName" tabindex="0" ?disabled=${this.busy} class="ff-property-field ff-input" @change=${this.onNameChange} value=${"Model"+this.modelOptions.length.toString()} touch-action="none" style="touch-action: none;" title="Parent.Name [string]"><div class="ff-fullsize ff-off ff-content"></div></input>
                    </div>
                </div>
                <div class="ff-flex-row sv-centered">
                    <ff-button icon="upload" class="ff-button ff-control" text=${language.getUILocalizedString("Import Model")} title=${language.getUILocalizedString("Import Model")} ?disabled=${this.busy} @click=${this.confirm}></ff-button>
                </div>
                <div class="ff-flex-row sv-centered sv-import-error-msg">
                    <div>${this.errorString}</div>
                </div>
            </div>
        </div>
        `;
    }

    protected onClickQuality(e: MouseEvent, index: number)
    {
        e.stopPropagation();
        if(this.busy) return;

        this.qualitySelection = EDerivativeQuality[EDerivativeQuality[index]];
        this.requestUpdate();
    }

    protected onClickParent(e: MouseEvent, index: number)
    {
        e.stopPropagation();
        if(this.busy) return;

        this.parentSelection = this.modelOptions[index] || {name: (this.querySelector("#modelName") as HTMLInputElement).value, id: "-1"};
        this.requestUpdate();
    }

    protected onNameChange() {
        this.parentSelection.name = (this.querySelector("#modelName") as HTMLInputElement).value;
    }
}
