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


import List from "@ff/ui/List";
import sanitizeHtml from 'sanitize-html';

import { ITour } from "client/schema/setup";

import CVToursTask from "../../components/CVToursTask";
import { TaskView, customElement, property, html } from "../../components/CVTask";
import { ILineEditChangeEvent } from "@ff/ui/LineEdit";

import CVDocument from "../../components/CVDocument";
import { IButtonClickEvent } from "@ff/ui/Button";
import { ELanguageType, DEFAULT_LANGUAGE, ELanguageStringType } from "client/schema/common";

////////////////////////////////////////////////////////////////////////////////

@customElement("sv-tours-task-view")
export default class ToursTaskView extends TaskView<CVToursTask>
{
    protected featureConfigMode = false;

    protected get snapshots() {
        return this.activeDocument.setup.snapshots;
    }

    protected renderFeatureMenu()
    {
        const features = this.snapshots.targetFeatures;
        const keys = Object.keys(features);
        const languageManager = this.activeDocument.setup.language;

        const buttons = keys.map(key => {
            const title = key[0].toUpperCase() + key.substr(1);
            const selected = !!features[key];
            return html`<ff-button text=${title} name=${key} ?selected=${selected} @click=${this.onClickFeature}></ff-button>`;
        });

        return html`<div class="sv-commands">
            <ff-button text="${languageManager.getUILocalizedString("OK")}" icon="" @click=${this.onFeatureMenuConfirm}></ff-button>
            <ff-button text="${languageManager.getUILocalizedString("Cancel")}" icon="" @click=${this.onFeatureMenuCancel}></ff-button>
        </div><div class="ff-flex-item-stretch sv-tour-feature-menu">${buttons}</div>`;
    }

    protected render()
    {
        //console.log("TourTaskView.render");

        if(!this.activeDocument) {
            return;
        }

        const task = this.task;
        const tours = task.tours;

        if (!tours) {
            return html`<div class="sv-placeholder">Please select a document to edit its tours.</div>`;
        }
        if (!tours.ins.enabled.value) {
            return html`<div class="sv-placeholder">Please activate the tour button in the main menu.</div>`;
        }

        if (this.featureConfigMode) {
            return this.renderFeatureMenu();
        }

        const tourList = tours.tours;
        const activeTour = tours.activeTour;
        const props = task.ins;
        const languageManager = this.activeDocument.setup.language;
        const activeLanguage = ELanguageType[languageManager.ins.activeLanguage.value];
        const primarySceneLanguage = ELanguageType[languageManager.ins.primarySceneLanguage.value];

        const detailView = activeTour ? html`<div class="ff-scroll-y ff-flex-column sv-detail-view">
            <sv-property-view .property=${languageManager.ins.activeLanguage}></sv-property-view>
            <div class="sv-label">${languageManager.getUILocalizedString("Title")}</div>
            <ff-line-edit name="title" text=${props.tourTitle.value} @change=${this.onTextEdit}></ff-line-edit>
            <div class="sv-label">${languageManager.getUILocalizedString("Tags")}</div>
            <ff-line-edit name="tags" text=${props.tourTags.value} @change=${this.onTextEdit}></ff-line-edit>
            <div class="sv-label">${languageManager.getUILocalizedString("Lead")}</div>
            <ff-text-edit name="lead" text=${props.tourLead.value} @change=${this.onTextEdit}></ff-text-edit>
        </div>` : null;

        return html`<div class="sv-commands">
            <ff-button title="${languageManager.getUILocalizedString("Create Tour")}" icon="create" @click=${this.onClickCreate}></ff-button>
            <ff-button title="${languageManager.getUILocalizedString("Move Tour Up")}" icon="up" ?disabled=${!activeTour} @click=${this.onClickUp}></ff-button>
            <ff-button title="${languageManager.getUILocalizedString("Move Tour Down")}" icon="down" ?disabled=${!activeTour} @click=${this.onClickDown}></ff-button>
            <ff-button title="${languageManager.getUILocalizedString("Delete Tour")}" icon="trash" ?disabled=${!activeTour} @click=${this.onClickDelete}></ff-button>
            <ff-button title="${languageManager.getUILocalizedString("Snapshot Configuration")}" icon="bars" @click=${this.onClickConfig}></ff-button>
        </div>
        <div class="ff-flex-item-stretch">
            <div class="ff-flex-column ff-fullsize">
                <div class="ff-flex-row ff-group"><div class="sv-panel-header sv-task-item">${languageManager.getUILocalizedString("Default:") + " " + primarySceneLanguage}</div><div class="sv-panel-header sv-task-item sv-item-border-l">${languageManager.getUILocalizedString("Active:") + " " + activeLanguage}</div></div>
                <div class="ff-splitter-section" style="flex-basis: 30%">
                    <div class="ff-scroll-y ff-flex-column">
                        <sv-tour-list .data=${tourList.slice()} .selectedItem=${activeTour} .activeLanguage=${activeLanguage} .primarySceneLanguage=${primarySceneLanguage} @select=${this.onSelectTour}></sv-tour-list>
                    </div>
                </div>
                <ff-splitter direction="vertical"></ff-splitter>
                <div class="ff-splitter-section" style="flex-basis: 70%">
                    ${detailView}
                </div>
            </div>
        </div>`;
    }

    protected onClickCreate()
    {
        this.task.ins.createTour.set();
    }

    protected onClickDelete()
    {
        this.task.ins.deleteTour.set();
    }

    protected onClickUp()
    {
        this.task.ins.moveTourUp.set();
    }

    protected onClickDown()
    {
        this.task.ins.moveTourDown.set();
    }

    protected onClickConfig()
    {
        this.featureConfigMode = true;
        this.requestUpdate();
    }

    protected onSelectTour(event: ISelectTourEvent)
    {
        this.task.tours.ins.tourIndex.setValue(event.detail.index);
    }


    protected onFeatureMenuConfirm()
    {
        this.snapshots.updateTargets();

        this.featureConfigMode = false;
        this.requestUpdate();
    }

    protected onFeatureMenuCancel()
    {
        this.featureConfigMode = false;
        this.requestUpdate();
    }

    protected onClickFeature(event: IButtonClickEvent)
    {
        const features = this.snapshots.targetFeatures;
        const key = event.target.name;

        features[key] = !features[key];
        this.requestUpdate();
    }

    protected onTextEdit(event: ILineEditChangeEvent)
    {
        const task = this.task;
        const target = event.target;
        const text = event.detail.text;

        if (target.name === "title") {
            task.ins.tourTitle.setValue(sanitizeHtml(text));
        }
        else if (target.name === "lead") {
            task.ins.tourLead.setValue(sanitizeHtml(text, 
                {
                    allowedTags: [ 'b', 'i', 'em', 'strong', 'sup', 'sub' ],
                }
            ));
        }
        else if (target.name === "tags") {
            task.ins.tourTags.setValue(text);
        }
    }

    protected onActiveDocument(previous: CVDocument, next: CVDocument)
    {
        if (previous) {
            previous.setup.tours.outs.tourIndex.off("value", this.onUpdate, this);
        }
        if (next) {
            next.setup.tours.outs.tourIndex.on("value", this.onUpdate, this);
        }

        this.requestUpdate();
    }
}

////////////////////////////////////////////////////////////////////////////////

interface ISelectTourEvent extends CustomEvent
{
    target: TourList;
    detail: {
        tour: ITour;
        index: number;
    }
}

@customElement("sv-tour-list")
export class TourList extends List<ITour>
{
    @property({ attribute: false })
    selectedItem: ITour = null;

    @property({ attribute: false })
    activeLanguage: ELanguageType = null;

    @property({ attribute: false })
    primarySceneLanguage: ELanguageType = null;

    protected firstConnected()
    {
        super.firstConnected();
        this.classList.add("sv-tour-list");
    }

    protected renderItem(item: ITour)
    {
        // TODO: Temporary - remove when single string properties are phased out
        if(Object.keys(item.titles).length === 0) { 
            item.titles[this.primarySceneLanguage] = item.title;
        }
        const primaryTitle = item.titles[this.primarySceneLanguage];
        const activeTitle = item.titles[this.activeLanguage];
        const missingTitle = html `<span class="sv-missing-translation">Missing content</span>`
        
        return html`<div class="ff-flex-row ff-group">
        <div class="sv-task-item">${primaryTitle? primaryTitle : missingTitle}</div>
        <div class="sv-task-item sv-item-border-l">${activeTitle ? activeTitle : missingTitle}</div>
        </div>`;
    }

    protected isItemSelected(item: ITour)
    {
        return item === this.selectedItem;
    }

    protected onClickItem(event: MouseEvent, item: ITour, index: number)
    {
        this.dispatchEvent(new CustomEvent("select", {
            detail: { tour: item, index }
        }));
    }

    protected onClickEmpty(event: MouseEvent)
    {
        this.dispatchEvent(new CustomEvent("select", {
            detail: { tour: null, index: -1 }
        }));
    }
}