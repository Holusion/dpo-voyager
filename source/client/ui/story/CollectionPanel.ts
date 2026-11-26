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

import CVTaskProvider from "../../components/CVTaskProvider";
import sanitizeHtml from 'sanitize-html';

import DocumentView, { customElement, html } from "../explorer/DocumentView";
import CVDocument from "client/components/CVDocument";
import { ILineEditChangeEvent } from "client/../../libs/ff-ui/source/LineEdit";

////////////////////////////////////////////////////////////////////////////////

@customElement("sv-collection-panel")
export default class CollectionPanel extends DocumentView
{
    protected get taskProvider() {
        return this.system.getMainComponent(CVTaskProvider);
    }

    protected firstConnected()
    {
        this.classList.add("sv-panel", "sv-collection-panel");
    }

    protected render()
    {
        const languageManager = this.activeDocument.setup.language;

        const meta = this.activeDocument.meta;
        let customMetas = [];
        if(meta) {
            meta.collection.ids.forEach(id => {
                if(!["title","titles","intros"].includes(id)) {
                    customMetas.push(this.renderCustomMeta(id, meta.collection.get(id)));
                }
            })
        }

        return html`<div class="ff-scroll-y ff-flex-column" style="padding-bottom: 5px">
            <div class="sv-panel-header">
                <ff-icon name="document"></ff-icon>
                <div class="ff-text">Collection</div>
            </div>
            <sv-property-view .property=${languageManager.ins.activeLanguage}></sv-property-view>
            <div class="sv-indent">
                <div class="sv-label">Title</div>
                <ff-line-edit name="title" text=${this.activeDocument.ins.title.value || "Missing Title"} @change=${this.onTextEdit}></ff-line-edit>
                <div class="sv-label">Intro</div>
                <ff-text-edit name="intro" text=${this.activeDocument.ins.intro.value} @change=${this.onTextEdit}></ff-text-edit>
            </div>
            <div class="sv-label">Copyright</div>
            <ff-line-edit name="copyright" text=${this.activeDocument.ins.copyright.value} @change=${this.onTextEdit}></ff-line-edit>
            ${customMetas}
        </div>`;
    }

    /**
     * A field for a custom meta, keeping its value's type: an on/off switch for a boolean,
     * else (string, or anything else) a text field.
     */
    protected renderCustomMeta(id: string, value: any)
    {
        if (typeof value === "boolean") {
            // laid out like a boolean property view (PropertyBoolean)
            return html`<br><div class="sv-property-view"><div class="sv-property sv-property-boolean">
                <label class="ff-label ff-off">${id}</label>
                <div><ff-button role="switch" name=${id} aria-label=${id} aria-checked=${String(value)}
                    text=${value ? "On" : "Off"} ?selected=${value} @click=${() => this.onToggleMeta(id)}></ff-button></div>
            </div></div>`;
        }
        return html`<br><div class="sv-label">${id}</div>
            <ff-line-edit name=${id} text=${value ?? ""} @change=${this.onTextEdit}></ff-line-edit>`;
    }

    protected onToggleMeta(id: string)
    {
        const collection = this.activeDocument?.meta?.collection;
        if (collection) {
            collection.insert(!collection.get(id), id);
            this.requestUpdate();
        }
    }

    protected onTextEdit(event: ILineEditChangeEvent)
    {
        const activeDoc = this.activeDocument;

        if (activeDoc) {
            const target = event.target;
            const text = event.detail.text;

            if (target.name === "title") {
                activeDoc.ins.title.setValue(sanitizeHtml(text,
                    {
                        allowedTags: [ 'i' ]
                    }    
                ));
            }
            else if (target.name === "intro") {
                activeDoc.ins.intro.setValue(sanitizeHtml(text,
                    {
                        allowedTags: [ 'i','b','p' ]
                    }    
                ));
            }
            else if (target.name === "copyright") {
                activeDoc.ins.copyright.setValue(sanitizeHtml(text,
                    {
                        allowedTags: [ 'i','b','a' ]
                    }
                ));
            
            }
            else {
                // assign value from custom field, unless unchanged: the field commits its
                // text when it loses focus, which would turn a number or null into a string
                const collection = this.activeDocument.meta.collection;
                if (text !== String(collection.get(target.name) ?? "")) {
                    collection.insert(text, target.name);
                }
            }
        }
    }

    protected onActiveDocument(previous: CVDocument, next: CVDocument)
    {
        if (previous) {
            previous.setup.language.outs.activeLanguage.off("value", this.onUpdate, this);
            previous.outs.title.off("value", this.onUpdate, this);
            previous.outs.intro.off("value", this.onUpdate, this);
        }
        if (next) {
            next.outs.title.on("value", this.onUpdate, this);
            next.outs.intro.on("value", this.onUpdate, this);
            next.setup.language.outs.activeLanguage.on("value", this.onUpdate, this);
        }
    }
}