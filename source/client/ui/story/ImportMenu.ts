/**
 * 3D Foundation Project
 * Copyright 2021 Smithsonian Institution
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
import { EAssetType, EDerivativeQuality, EDerivativeUsage, EMapType, TAssetType, TDerivativeQuality, TDerivativeUsage } from "client/schema/model";
import CVModel2 from "client/components/CVModel2";

import { enumToArray } from "@ff/core/types";
import CustomElement, { TemplateResult, property } from "@ff/ui/CustomElement";

////////////////////////////////////////////////////////////////////////////////


interface Selections{
    usage: EDerivativeUsage;
    type: EAssetType;
    mapType: EMapType;
    quality: EDerivativeQuality;
};

type Section = keyof Selections;


export interface ImportResult extends Selections {
    parentName: string;
}

const titles = {
    usage: "Derivative Usage",
    type: "Asset Type",
    mapType: "Map type",
    quality: "Derivative Quality",
};

@customElement("sv-import-menu")
export default class ImportMenu extends Popup
{
    protected url: string;
    protected language: CVLanguageManager = null;
    protected filename: string = "";
    protected errorString: string = "";

    protected modelOptions: {name: string, id: string}[] = [];

    public selection :Selections = {
        usage: EDerivativeUsage.Web3D,
        type: EAssetType.Model,
        mapType: null,
        quality: null,
    };

    private options :Record<Section, string[]> = {
        usage: enumToArray(EDerivativeUsage),
        type: enumToArray(EAssetType),
        mapType: enumToArray(EMapType),
        quality: enumToArray(EDerivativeQuality),
    };

    private expanded :Record<Section, Boolean> = {
        usage: false,
        type: false,
        mapType: false,
        quality: true,
    }


    protected parentSelection: {name: string, id: string} = null;

    static show(parent: HTMLElement, language: CVLanguageManager, filename: string): Promise<ImportResult>
    {
        const menu = new ImportMenu(language, filename);
        parent.appendChild(menu);

        return new Promise((resolve, reject) => {
            menu.on("confirm", () => resolve({...menu.selection, parentName: menu.parentSelection.name}));
            menu.on("close", () => reject());
        });
    }

    constructor( language: CVLanguageManager, filename: string )
    {
        super();

        this.language = language;
        this.filename = filename;
        const models = language.getGraphComponents(CVModel2);
        this.modelOptions = this.modelOptions.concat(models.map(model => ({name: model.node.name, id: model.id})));
        
        
        this.position = "center";
        this.modal = true;
        let allowedTypes = [];
        if(this.is_model){
            allowedTypes = [EAssetType.Model];
        }else if(this.is_image){
            this.expanded["mapType"] = true;
            this.selection["type"] = EAssetType.Image;
            allowedTypes  = [EAssetType.Image, EAssetType.Texture];
        }else{
            allowedTypes  = [EAssetType.Geometry, EAssetType.Points, EAssetType.Volume];
        }
        this.options["type"] = allowedTypes.reduce((a, t)=>{
            a[t] = EAssetType[t];
            return a;
        }, []);
        this.parentSelection = this.modelOptions.length > 0 ? this.modelOptions[0] : {name: "Model"+this.modelOptions.length.toString(), id: "-1"};
        
        this.url = window.location.href;
    }

    close()
    {
        this.dispatchEvent(new CustomEvent("close"));
        this.remove();
    }

    confirm()
    {
        if(this.selection["quality"] === null && this.options["quality"].filter(q=>q).length == 1){
            this.selection["quality"] = EDerivativeQuality[this.options["quality"].find(q=>q)];
        }

        if(this.selection["quality"] === null) {
            this.errorString = "Please select derivative quality.";
            this.requestUpdate();
            return;
        }

        if(this.selection["type"] === null) {
            this.errorString = "Please select derivative type.";
            this.requestUpdate();
            return;
        }

        if(  this.selection["usage"] === EDerivativeUsage.Web3D
                && this.selection["type"] === EAssetType.Image 
                && this.selection["mapType"] === null
            ) {
            this.errorString = "Please select map type.";
            this.requestUpdate();
            return;
        }

        if(this.selection["usage"] === null) {
            this.errorString = "Please select derivative usage.";
            this.requestUpdate();
            return;
        }

        this.dispatchEvent(new CustomEvent("confirm"));
        this.remove();
    }

    protected firstConnected()
    {
        super.firstConnected();
        this.classList.add("sv-option-menu", "sv-import-menu");
    }

    get is_image(){
        return /\.(jpe?g|png|webp)$/i.test(this.filename);
    }
    get is_model(){
        return /\.(glb|gltf|usdz)$/i.test(this.filename);
    }

    protected handleClick(name :Section, value: number|null, e: MouseEvent){
        e?.stopPropagation();
        if(value === this.selection[name]) return;
        (this.selection[name] as any) = value as any;
        (this.expanded[name] as any) = false;
        this.requestUpdate();
    }

    protected renderEntry(name: Section, value: number)
    {
        const list = this.options[name];
        return html`<div class="sv-entry" @click=${e => this.handleClick(name, value, e)} ?selected=${ value === this.selection[name] }>
            ${list[value]}
        </div>`;
    }

    protected renderChoices<T>(name: Section){
        const list = this.options[name];

        return html`<div>
            ${list.map((key, index) => this.renderEntry(name, index))}
        </div>`
    }

    protected renderSection(name :Section){
        const toggle = ()=>{
            this.expanded[name] = !this.expanded[name];
            this.requestUpdate();
        }
        return html`
            <div class="ff-flex-row ff-header" @click=${toggle}>
                <div class="ff-flex-spacer">
                    ${this.language.getLocalizedString(titles[name])}:
                </div>
                <span style="flex:0 1 auto;padding-right:4px;text-overflow: ellipsis;">${((this.expanded[name] && this.selection[name])? "": this.options[name][this.selection[name]])}</span>
                <ff-icon name="caret-${this.expanded[name]?"up":"down"}"></ff-icon>
            </div>
            ${this.expanded[name]? html`<div class="">
                ${this.renderChoices(name)}
            </div>`:null}
        `
    }

    protected renderParentEntry(option: string, index: number)
    {
        return html`<div class="sv-entry" @click=${e => this.onClickParent(e, index)} ?selected=${ option === this.parentSelection.name }>
            ${option}
        </div>`;
    }


    protected update(changedProperties){
        if(this.selection["type"] === EAssetType.Model){
            this.options["quality"] = enumToArray(EDerivativeQuality);
        }else{
            const model = this.language.getGraphComponents(CVModel2).find(m=>m.id == this.parentSelection.id);
            if(model){
                this.options["quality"] = model.derivatives.getByUsage(this.selection["usage"]).map(d=>d.data.quality).reduce((a, q)=>{
                    a[q] = EDerivativeQuality[q];
                    return a;
                }, []);
                if(!this.options["quality"].includes(EDerivativeQuality[this.selection["quality"]])){
                    this.selection["quality"] = null;
                }
            }
        }


        return super.update(changedProperties);
    }

    protected render()
    {
        const language = this.language;
        return html`
        <div>
            <div class="ff-flex-column ff-fullsize ff-scroll-y">
                <div class="ff-flex-row">
                    <div class="ff-flex-spacer ff-title">${"File: "}<i>${this.filename}</i></div>
                    <ff-button icon="close" transparent class="ff-close-button" title=${language.getLocalizedString("Close")} @click=${this.close}></ff-button>
                </div>
                <div class="ff-splitter-section">

                    ${this.renderSection("usage")}

                    ${1 < this.options["type"].length? this.renderSection("type"):null}

                    ${ this.selection["type"] == EAssetType.Image && this.selection["usage"] == EDerivativeUsage.Web3D ?
                        this.renderSection("mapType")
                        : null
                    }

                    ${1 < this.options["quality"].filter(q=>q).length ? this.renderSection("quality"): null}
                </div>
                <div class="ff-flex-row">
                    <div class="ff-flex-spacer ff-header">${language.getLocalizedString("Parent Node")}:</div>
                </div>
                <div>
                    ${this.modelOptions.length > 0 ? html`<div >
                        ${this.modelOptions.map((option, index) => this.renderParentEntry(option.name, index))}
                    </div>` : html`<div class="ff-flex-row sv-centered sv-notification" style="height:100%; align-items:center">No Models In Scene</div>`}
                </div>
                ${this.is_model? html`<div class="sv-entry" @click=${e => this.onClickParent(e, -1)} ?selected=${ "-1" === this.parentSelection.id }>
                    <div class="ff-flex-row">
                        <label class="ff-label ff-off">${language.getLocalizedString("Add New Model")}:</label>
                        <div class="ff-flex-spacer"></div>
                        <input id="modelName" tabindex="0" class="ff-property-field ff-input" @change=${this.onNameChange} value=${"Model"+this.modelOptions.length.toString()} touch-action="none" style="touch-action: none;" title="Parent.Name [string]"><div class="ff-fullsize ff-off ff-content"></div></input>
                    </div>
                </div>`: null}
                <div class="ff-flex-row sv-centered">
                    <ff-button icon="upload" class="ff-button ff-control" text=${language.getLocalizedString("Import Model")} title=${language.getLocalizedString("Import Model")} @click=${this.confirm}></ff-button>
                </div>
                <div class="ff-flex-row sv-centered sv-import-error-msg">
                    <div>${this.errorString}</div>
                </div>
            </div>
        </div>
        `;
    }

    protected onClickParent(e: MouseEvent, index: number)
    {
        e.stopPropagation();

        this.parentSelection = this.modelOptions[index] || {name: (this.querySelector("#modelName") as HTMLInputElement).value, id: "-1"};
        this.requestUpdate();
    }

    protected onNameChange() {
        this.parentSelection.name = (this.querySelector("#modelName") as HTMLInputElement).value;
    }
}
