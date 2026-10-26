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

import { types } from "@ff/graph/Component";
import CPickSelection from "@ff/scene/components/CPickSelection";
import Subscriber from "@ff/core/Subscriber";

import CVNodeObserver from "./CVNodeObserver";
import CVDocument from "./CVDocument";

import NodeView, { customElement, property, html } from "../ui/explorer/NodeView";
import Property from "@ff/graph/Property";
import CVDocumentProvider from "./CVDocumentProvider";

////////////////////////////////////////////////////////////////////////////////

export { types, customElement, property, html };

export interface CVTaskConfiguration{
    bracketsVisible?: boolean,
    interfaceVisible?: boolean,
    gridVisible?: boolean,
    annotationsVisible?: boolean,
    readerEnabled?: boolean,
    toursEnabled?: boolean,
    gridLabelEnabled?: boolean,
    environmentVisible?: boolean,
    axesVisible?: boolean,
    lodEnabled?: boolean
}

/**
 * Base class for tasks in the Voyager Story authoring environment. A task provides a number of tools. The tools operate
 * in the context of the currently selected node or component.
 *
 * In order to be aware of the currently selected node, CVTask inherits from CVNodeObserver.
 */
export default class CVTask extends CVNodeObserver
{
    static readonly typeName: string = "CVTask";

    static readonly text: string = "Task";
    static readonly icon: string = "fa fa-tasks";
    /** Tasks without a task bar button are started from the panel that offers them. */
    static readonly inTaskBar: boolean = true;

    protected static readonly taskIns = {
    };

    protected static readonly taskOuts = {
        isActive: types.Boolean("Task.IsActive"),
    };

    ins = this.addInputs(CVTask.taskIns);
    outs = this.addOutputs(CVTask.taskOuts);

    protected get selection() {
        return this.getMainComponent(CPickSelection);
    }
    get inTaskBar() {
        return (this.constructor as typeof CVTask).inTaskBar;
    }
    protected get isActiveTask() {
        return this.outs.isActive.value;
    }

    private _configuredDocument: CVDocument = null;
    private _savedActiveTags = "";
    private _savedReaderArticleId = "";

    protected configuration :CVTaskConfiguration = {
        bracketsVisible: undefined,
        interfaceVisible: undefined,
        gridVisible: undefined,
        annotationsVisible: undefined,
        lodEnabled: undefined,
    };

    private _savedConfig :CVTaskConfiguration = {
        bracketsVisible: undefined,
        interfaceVisible: undefined,
        gridVisible: undefined,
        annotationsVisible: undefined,
        lodEnabled: undefined,
    };

    dispose()
    {
        if (this.isActiveTask) {
            this.deactivateTask();
        }

        super.dispose();
    }

    createView(): TaskView
    {
        throw new Error("must override");
    }

    /**
     * Called when the task is activated.
     */
    activateTask()
    {
        this.startObserving();
        this.outs.isActive.setValue(true);
        const configuration = this.configuration;
        const savedConfig = this._savedConfig;
        savedConfig.bracketsVisible = this.selection.ins.viewportBrackets.value;
        if (typeof configuration.bracketsVisible !== "undefined") {
            const prop = this.selection.ins.viewportBrackets;
            prop.setValue(!!configuration.bracketsVisible);
        }
        if (this.activeDocument) {
            this.applyConfiguration(this.activeDocument);
        }
    }

    /**
     * Called when the task is deactivated.
     */
    deactivateTask()
    {
        const savedConfig = this._savedConfig;
        this.restoreConfiguration();

        if (typeof savedConfig.bracketsVisible !== "undefined") {
            this.selection.ins.viewportBrackets.setValue(savedConfig.bracketsVisible);
        }

        this.outs.isActive.setValue(false);
        this.stopObserving();
    }

    /**
     * Called when the currently active document changes.
     */
    protected onActiveDocument(previous: CVDocument, next: CVDocument)
    {
        // Initial observation precedes activation; later document switches restore and apply task overrides.
        if (this.isActiveTask) {
            this.restoreConfiguration();
            if (next) {
                this.applyConfiguration(next);
            }
        }
    }

    private getViewportProperties(document: CVDocument): Record<Exclude<keyof CVTaskConfiguration, "bracketsVisible">, Property<boolean>>
    {
        const setup = document.setup;
        return {
            gridVisible: setup.grid.ins.visible,
            annotationsVisible: setup.viewer.ins.annotationsVisible,
            interfaceVisible: setup.interface.ins.visible,
            readerEnabled: setup.reader.ins.enabled,
            toursEnabled: setup.tours.ins.enabled,
            gridLabelEnabled: setup.grid.ins.labelEnabled,
            environmentVisible: setup.environment.ins.visible,
            axesVisible: setup.grid.ins.axesEnabled,
            lodEnabled: setup.derivatives.ins.enabled,
        };
    }

    private applyConfiguration(document: CVDocument)
    {
        this._configuredDocument = document;
        this._savedActiveTags = document.setup.viewer.ins.activeTags.value;
        this._savedReaderArticleId = document.setup.reader.ins.articleId.value;

        const properties = this.getViewportProperties(document);
        for (const key of Object.keys(properties) as Array<keyof typeof properties>) {
            this._savedConfig[key] = properties[key].value;
            const value = this.configuration[key];
            if (value !== undefined) {
                if (key === "toursEnabled") {
                    document.setup.tours.setEnabled(value, false);
                }
                else {
                    properties[key].setValue(value);
                }
            }
        }
    }

    private restoreConfiguration()
    {
        const document = this._configuredDocument;
        const savedConfig = this._savedConfig;
        if (!document) {
            return;
        }
        this._configuredDocument = null;
        // Cancel task previews before restoring flags so a later tick cannot overwrite them.
        document.setup.snapshots.cancelTween();
        document.setup.viewer.ins.activeTags.setValue(this._savedActiveTags);
        document.setup.reader.ins.articleId.setValue(this._savedReaderArticleId);

        const properties = this.getViewportProperties(document);
        for (const key of Object.keys(properties) as Array<keyof typeof properties>) {
            if (key === "toursEnabled") {
                document.setup.tours.setEnabled(savedConfig[key], savedConfig[key]);
            }
            else {
                properties[key].setValue(savedConfig[key]);
            }
        }
    }
}

////////////////////////////////////////////////////////////////////////////////

/**
 * Base class for task view components.
 */
export class TaskView<T extends CVTask = CVTask> extends NodeView
{
    private documentSubscriber = new Subscriber("value", this.onUpdate, this);

    @property({ attribute: false })
    task: T = null;

    constructor(task?: T)
    {
        super(task.system);
        this.task = task;
    }
    protected get documentProperties(): Property[]
    {
        return [this.activeDocument.setup.language.outs.uiLanguage];
    }

    protected onActiveDocument(previous: CVDocument, next: CVDocument)
    {
        this.documentSubscriber.off();
        if (next) {
            this.documentSubscriber.on(...this.documentProperties);
        }
        this.requestUpdate();
    }

    protected firstConnected()
    {
        this.classList.add("sv-task-view");
    }
}