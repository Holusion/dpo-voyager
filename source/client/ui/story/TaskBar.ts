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

import System from "@ff/graph/System";

import "@ff/ui/Button";
import Button, { IButtonClickEvent } from "@ff/ui/Button";

import SystemView, { customElement, html } from "@ff/scene/ui/SystemView";

import CVStoryApplication from "../../components/CVStoryApplication";
import CVSaveState from "../../components/CVSaveState";
import CVTaskProvider, { ETaskMode, IActiveTaskEvent, ITaskSetEvent } from "../../components/CVTaskProvider";
import CVAssetReader from "../../components/CVAssetReader";
import CVLanguageManager from "client/components/CVLanguageManager";
import { getFocusableElements } from "client/utils/focusHelpers";


////////////////////////////////////////////////////////////////////////////////

@customElement("sv-task-bar")
export default class TaskBar extends SystemView
{
    protected story: CVStoryApplication = null;
    protected taskProvider: CVTaskProvider = null;

    constructor(system?: System)
    {
        super(system);

        this.story = system.getMainComponent(CVStoryApplication);
        this.taskProvider = system.getMainComponent(CVTaskProvider);
    }

    protected get assetReader() {
        return this.system.getMainComponent(CVAssetReader);
    }

    protected get language() {
        return this.system.getComponent(CVLanguageManager);
    }

    protected get saveState() {
        return this.system.getMainComponent(CVSaveState);
    }

    protected firstConnected()
    {
        this.classList.add("sv-task-bar");
        this.setAttribute("role", "toolbar");
        this.onkeydown = this.onKeyDown.bind(this);
    }

    protected connected()
    {
        this.taskProvider.on<ITaskSetEvent>("scoped-components", this.onUpdate, this);
        this.taskProvider.on<IActiveTaskEvent>("active-component", this.onUpdate, this);
        this.language.outs.uiLanguage.on("value", this.onUpdate, this);
        this.saveState.outs.dirty.on("value", this.onUpdate, this);
        this.saveState.outs.canUndo.on("value", this.onUpdate, this);
        this.saveState.outs.canRedo.on("value", this.onUpdate, this);
        this.saveState.outs.undoTitle.on("value", this.onUpdate, this);
        this.saveState.outs.redoTitle.on("value", this.onUpdate, this);
    }

    protected disconnected()
    {
        this.taskProvider.off<ITaskSetEvent>("scoped-components", this.onUpdate, this);
        this.taskProvider.off<IActiveTaskEvent>("active-component", this.onUpdate, this);
        this.language.outs.uiLanguage.on("value", this.onUpdate, this);
        this.saveState.outs.dirty.off("value", this.onUpdate, this);
        this.saveState.outs.canUndo.off("value", this.onUpdate, this);
        this.saveState.outs.canRedo.off("value", this.onUpdate, this);
        this.saveState.outs.undoTitle.off("value", this.onUpdate, this);
        this.saveState.outs.redoTitle.off("value", this.onUpdate, this);
    }

    protected render()
    {
        const tasks = this.taskProvider.scopedComponents;
        const activeTask = this.taskProvider.activeComponent;
        const taskMode = this.taskProvider.ins.mode.value;
        const taskModeText = this.taskProvider.ins.mode.getOptionText();
        const downloadButtonVisible = taskMode !== ETaskMode.Standalone;
        const exitButtonVisible = taskMode !== ETaskMode.Standalone;
        const languageManager = this.language;
        const saveName = languageManager.getUILocalizedString(taskMode !== ETaskMode.Standalone ? "Save" : "Download");
        const unsaved = this.saveState.outs.dirty.value;
        const canUndo = this.saveState.outs.canUndo.value;
        const canRedo = this.saveState.outs.canRedo.value;

        // The tooltip says what the press would actually do - "Undo Floor
        // opacity from 0.25 to 0.9" - so the button is not a leap of faith.
        const undoText = languageManager.getUILocalizedString("Undo");
        const redoText = languageManager.getUILocalizedString("Redo");
        const undoTitle = canUndo
            ? `${undoText} ${this.saveState.outs.undoTitle.value} (Ctrl+Z)`
            : `${undoText} (Ctrl+Z)`;
        const redoTitle = canRedo
            ? `${redoText} ${this.saveState.outs.redoTitle.value} (Ctrl+Shift+Z)`
            : `${redoText} (Ctrl+Shift+Z)`;
        return html`
            <img class="sv-story-logo" src=${this.assetReader.getSystemAssetUrl("images/voyager-75grey.svg")} alt="Logo"/>
            <div class="sv-mode ff-text">${taskModeText}</div>
            <div class="sv-spacer"></div>
            <div class="sv-divider"></div>
            <div class="ff-flex-row ff-group" @click=${this.onClickTask}>
                ${tasks.map((task, index) => html`<ff-button text=${languageManager.getUILocalizedString(task.text)} icon=${task.icon} index=${index} ?selected=${task === activeTask}></ff-button>`)}
            </div>
            <div class="sv-divider"></div>
            <div class="sv-spacer"></div>
            <div class="sv-divider"></div>
            <div class="ff-flex-row ff-group">
                <ff-button text=${undoText} title="${undoTitle}" icon="undo" ?disabled=${!canUndo} @click=${this.onClickUndo}></ff-button>
                <ff-button text=${redoText} title="${redoTitle}" icon="redo" ?disabled=${!canRedo} @click=${this.onClickRedo}></ff-button>
            </div>
            <div class="sv-divider"></div>
            <div class="ff-flex-row ff-group">
                <ff-button ?data-unsaved=${unsaved} text=${saveName} title=${unsaved ? "Unsaved changes" : saveName} icon="save" @click=${this.onClickSave}></ff-button>
                ${downloadButtonVisible ? html`<ff-button text="${languageManager.getUILocalizedString("Download")}" icon="download" @click=${this.onClickDownload}></ff-button>` : null}
                ${exitButtonVisible ? html`<ff-button text="${languageManager.getUILocalizedString("Exit")}" icon="exit" @click=${this.onClickExit}></ff-button>` : null}
            </div>
        `;
    }

    protected onClickTask(event: IButtonClickEvent)
    {
        if (event.target instanceof Button) {
            const tasks = this.taskProvider.scopedComponents;
            this.taskProvider.activeComponent = tasks[event.target.index];
        }
    }

    protected onClickUndo()
    {
        this.saveState.undo();
    }

    protected onClickRedo()
    {
        this.saveState.redo();
    }

    protected onClickSave()
    {
        this.story.ins.save.set();
    }

    protected onClickDownload()
    {
        this.story.ins.download.set();
    }

    protected onClickExit()
    {
        this.story.ins.exit.set();
    }

    protected onKeyDown(e: KeyboardEvent, id: string)
    {
        if(e.code === "Tab") {
            const buttons = getFocusableElements(this);
            buttons.shift();
            buttons.forEach((element) => element.setAttribute("tabIndex", "-2"))
        }
        else if(e.code === "ArrowLeft" || e.code === "ArrowRight") {
            const currentActive = e.target instanceof Element ? e.target as Element : null;
            if(currentActive) {
                const buttons = getFocusableElements(this);
                let activeIdx = buttons.findIndex((elem) => elem === currentActive);
                activeIdx = e.code === "ArrowRight" ? Math.min(activeIdx + 1, buttons.length - 1) : Math.max(activeIdx - 1, 0);

                const newActive = buttons[activeIdx];
                if(newActive) {
                    (newActive as HTMLElement).focus();
                }
            }
        }
    }
}