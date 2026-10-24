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

import sanitizeHtml from 'sanitize-html';

import { ILineEditChangeEvent } from "@ff/ui/LineEdit";

import CVCollectionTask from "../../components/CVCollectionTask";
import { TaskView, customElement, html } from "../../components/CVTask";

////////////////////////////////////////////////////////////////////////////////

@customElement("sv-collection-task-view")
export default class CollectionTaskView extends TaskView<CVCollectionTask>
{
    protected connected()
    {
        super.connected();
        this.task.ins.showNotes.on("value", this.onUpdate, this);
    }

    protected disconnected()
    {
        this.task.ins.showNotes.off("value", this.onUpdate, this);
        super.disconnected();
    }

    protected get documentProperties()
    {
        const document = this.activeDocument;
        return [
            ...super.documentProperties,
            document.setup.language.outs.activeLanguage,
            document.outs.title,
            document.outs.intro,
            document.ins.copyright,
        ];
    }

    protected render()
    {
        if (!this.activeDocument) {
            return;
        }
        const languageManager = this.activeDocument.setup.language;

        const meta = this.activeDocument.meta;
        let customMetas = [];
        if(meta) {
            meta.collection.ids.forEach(id => {
                if(!["title","titles","intros"].includes(id)) {
                    customMetas.push(html`<br><div class="sv-label">${id}</div>
                    <ff-line-edit name=${id} text=${meta.collection.get(id)} @change=${this.onTextEdit}></ff-line-edit>`);
                }
            })
        }

        const showNotes = this.task.ins.showNotes.value;

        return html`<div class="sv-commands">
                <ff-button text="${languageManager.getUILocalizedString(showNotes ? "Hide Notes" : "Show Notes")}" icon="comment"
                    ?selected=${showNotes} @click=${this.onClickNotes}></ff-button>
            </div>
            <div class="ff-flex-item-stretch"><div class="ff-scroll-y ff-flex-column sv-detail-view">
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
            </div></div>`;
    }

    protected onClickNotes()
    {
        const showNotes = this.task.ins.showNotes;
        showNotes.setValue(!showNotes.value);
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
                // assign value from custom field
                this.activeDocument.meta.collection.insert(text,target.name);
            }
        }
    }
}
