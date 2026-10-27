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

import { IComponentEvent, Node, types } from "@ff/graph/Component";

import CComponentProvider, {
    EComponentScope,
    IActiveComponentEvent,
    IScopedComponentsEvent,
} from "@ff/graph/components/CComponentProvider";

import CVTask from "./CVTask";
import CVDerivativesTask from "./CVDerivativesTask";
import taskSets, { ETaskMode } from "../applications/taskSets";
import { DEFAULT_LANGUAGE, ELanguageStringType, ELanguageType } from "client/schema/common";
import CVLanguageManager from "./CVLanguageManager";

////////////////////////////////////////////////////////////////////////////////

export { ETaskMode };

export type IActiveTaskEvent = IActiveComponentEvent<CVTask>;
export type ITaskSetEvent = IScopedComponentsEvent;

/**
 * Manages available tasks and keeps track of the currently active task.
 * Follows selection: if a task component is selected, it becomes the active task.
 */
export default class CVTaskProvider extends CComponentProvider<CVTask>
{
    static readonly typeName: string = "CVTaskProvider";
    static readonly isSystemSingleton = true;
    static readonly componentType = CVTask;

    protected static readonly ins = {
        mode: types.Enum("Tasks.Mode", ETaskMode),
    };

    ins = this.addInputs(CVTaskProvider.ins);

    private _assetsPanelActive = false;
    private _runningTask: CVTask = null;
    private _switching = false;

    get activeComponent() {
        return super.activeComponent;
    }
    set activeComponent(task: CVTask) {
        if (task === super.activeComponent) {
            return;
        }
        if (task && !this.isComponentInScope(task)) {
            throw new Error("can't activate, component out of scope");
        }
        this.run(task);
        this._assetsPanelActive = false;
        super.activeComponent = task;
    }

    get assetsTask() {
        return this.scopedComponents.find(task => task instanceof CVDerivativesTask) as CVDerivativesTask;
    }

    get assetsPanelActive() {
        return this._assetsPanelActive;
    }
    set assetsPanelActive(active: boolean) {
        if (active === this._assetsPanelActive || !this.assetsTask) {
            return;
        }
        // Keep the current task selected while the Assets tab temporarily owns the viewport,
        // and resume it on leaving the tab.
        this.run(active ? this.assetsTask : this.activeComponent);
        this._assetsPanelActive = active;
    }

    constructor(node: Node, id: string)
    {
        super(node, id);
        this.scope = EComponentScope.Node;
    }

    protected get languageManager() {
        return this.getSystemComponent(CVLanguageManager);
    }

    get expertMode() {
        return this.ins.mode.getValidatedValue() === ETaskMode.Expert;
    }

    update(context)
    {
        const ins = this.ins;
        const languageManager = this.languageManager;

        if (ins.mode.changed) {
            this.activeComponent = null;
            this.assetsPanelActive = false;
            // Disposal removes entries from the provider's live list.
            [...this.scopedComponents].forEach(task => task.dispose());

            const taskSet = taskSets[ins.mode.getValidatedValue()];
            taskSet.forEach(taskType => this.createComponent(taskType));
        }

        return true;
    }

    protected onActiveComponent(previous: CVTask, next: CVTask)
    {
    }

    protected onComponent(event: IComponentEvent)
    {
        // A task disposed while running has stopped itself (see CVTask.dispose).
        if (event.remove && event.object === this._runningTask) {
            this._runningTask = null;
            if (this._assetsPanelActive) {
                this._assetsPanelActive = false;
                this.run(this.activeComponent);
            }
        }
        super.onComponent(event);
    }

    dispose()
    {
        this.activeComponent = null;
        this.assetsPanelActive = false;
        super.dispose();
    }

    /**
     * Tasks start and stop here only, so that at most one task runs: the active task,
     * or the Assets task while the Assets tab is shown.
     * Starting or stopping a task can't switch tasks itself. If a task fails to start or stop,
     * no task is left running or selected, and the error is rethrown.
     */
    private run(task: CVTask)
    {
        if (this._switching) {
            throw new Error("can't switch tasks while a task starts or stops");
        }
        const running = this._runningTask;
        if (task === running) {
            return;
        }

        this._switching = true;
        this._runningTask = null;
        let starting: CVTask = null;
        try {
            running?.deactivateTask();
            starting = task;
            task?.activateTask();
            this._runningTask = task;
        }
        catch (error) {
            // Stopping undoes what a task set up before it failed to start.
            try {
                starting?.deactivateTask();
            }
            catch (stopError) {
                console.error(stopError);
            }
            this._switching = false;
            this._assetsPanelActive = false;
            super.activeComponent = null;
            throw error;
        }
        this._switching = false;
    }
}