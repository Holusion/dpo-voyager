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

import SystemView, { customElement, html } from "@ff/scene/ui/SystemView";

import CVTaskProvider, { IActiveTaskEvent } from "../../components/CVTaskProvider";
import CVNodeProvider, { IActiveNodeEvent } from "../../components/CVNodeProvider";
import { TaskView } from "../../components/CVTask";

////////////////////////////////////////////////////////////////////////////////

/**
 * Panel displaying the user interface for the currently active task.
 */
@customElement("sv-task-panel")
export default class TaskPanel extends SystemView
{
    protected taskProvider: CVTaskProvider = null;
    private view: TaskView = null;

    constructor(system?: System)
    {
        super(system);

        this.taskProvider = system.getMainComponent(CVTaskProvider);

        if (!this.taskProvider) {
            throw new Error("missing task provider");
        }
    }

    protected firstConnected()
    {
        this.classList.add("sv-scrollable", "sv-panel", "sv-task-panel");
    }

    protected connected()
    {
        super.connected();
        this.taskProvider.on<IActiveTaskEvent>("active-component", this.onUpdate, this);
        // The title names the task's subject, which follows the selection.
        this.system.getMainComponent(CVNodeProvider).on<IActiveNodeEvent>("active-node", this.onUpdate, this);
    }

    protected disconnected()
    {
        this.taskProvider.off<IActiveTaskEvent>("active-component", this.onUpdate, this);
        this.system.getMainComponent(CVNodeProvider).off<IActiveNodeEvent>("active-node", this.onUpdate, this);
        super.disconnected();
    }

    protected render()
    {
        const task = this.taskProvider.activeComponent;
        if (!task) {
            this.view = null;
            return html``;
        }

        // Each activation gets a fresh view, kept across title updates.
        if (this.view?.task !== task) {
            this.view = task.createView();
        }
        const subject = task.subject;

        return html`
            <div class="sv-panel-header">
                <ff-icon name=${task.icon}></ff-icon>
                <div class="ff-text">${task.text}</div>
                ${subject ? html`<div class="sv-task-subject">${subject.model ? html`<ff-icon class="sv-icon-model" name=${subject.model.icon}></ff-icon>` : null}
                    <div class="ff-text ff-ellipsis">${subject.displayName}</div></div>` : null}
                <ff-button class="sv-end-task" icon="close" title="Close Task" aria-label="Close task" @click=${this.onEndTask}></ff-button>
            </div>
            <div class="sv-panel-content">
                ${this.view}
            </div>
        `;
    }

    protected onEndTask()
    {
        this.taskProvider.activeComponent = null;
    }
}