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

import { Node, types } from "@ff/graph/Component";

import CComponentProvider, {
    EComponentScope,
    IActiveComponentEvent,
    IScopedComponentsEvent
} from "@ff/graph/components/CComponentProvider";

import CVDocument, { IDocument } from "./CVDocument";

import { EDocumentState } from "client/schema/document";

////////////////////////////////////////////////////////////////////////////////

export { EDocumentState };

export type IActiveDocumentEvent = IActiveComponentEvent<CVDocument>;
export type IDocumentsEvent = IScopedComponentsEvent;

export default class CVDocumentProvider extends CComponentProvider<CVDocument>
{
    static readonly typeName: string = "CVDocumentProvider";
    static readonly componentType = CVDocument;

    protected static readonly outs = {
        activeDocument: types.Object("Documents.Active", CVDocument),
        changedDocuments: types.Event("Documents.Changed"),
        state: types.Enum("Documents.State", EDocumentState, EDocumentState.Ready),
    };

    outs = this.addOutputs(CVDocumentProvider.outs);

    private _loading = false;
    private _error = false;

    constructor(node: Node, id: string)
    {
        super(node, id);
        this.scope = EComponentScope.Node;
    }

    // -- lifecycle state -------------------------------------------------------
    // Driven explicitly by the load methods, so the state is reliable on failure
    // and on model-less scenes (rather than inferred from asset-manager flags).

    /** Marks a load as in flight (fetching / parsing / building the scene graph). */
    setLoading()
    {
        this._loading = true;
        this._error = false;
        this.updateState();
    }

    /**
     * Marks the in-flight load finished: the scene graph is built and the viewer
     * is INTERACTABLE (navigation works, the scene structure exists).
     *
     * This is deliberately orthogonal to model derivative quality. Individual
     * models stream their derivatives (thumb -> full) independently and report
     * that progress via the `model-load` event and the viewer's `sceneLoaded`
     * output. "Ready" therefore does NOT mean "all models at target quality" -
     * that "fully loaded" signal is a separate concern, left untouched here, so
     * load-time-to-full-quality analytics and quality thresholds can be defined
     * without affecting the lifecycle state. See docs/architecture-lifecycle.md.
     */
    setReady()
    {
        this._loading = false;
        this._error = false;
        this.updateState();
    }

    /** Marks the in-flight load as failed. */
    setError()
    {
        this._loading = false;
        this._error = true;
        this.updateState();
    }

    /** Current lifecycle state name, for the public API. */
    getState(): string
    {
        return EDocumentState[this.outs.state.value];
    }

    protected updateState()
    {
        let state: EDocumentState;
        if (this._error) {
            state = EDocumentState.Error;
        }
        else if (this._loading) {
            state = EDocumentState.Loading;
        }
        else {
            state = EDocumentState.Ready;
        }

        this.outs.state.setValue(state);
    }

    createDocument(data?: IDocument, path?: string)
    {
        const document = this.node.createComponent(CVDocument);
        this.activeComponent = document;

        if (data) {
            document.openDocument(data, path);
        }

        return document;
    }

    amendDocument(data: IDocument, path: string, merge: boolean)
    {
        const document = this.activeComponent;
        if (!document) {
            throw new Error("no active document, can't amend");
        }

        document.openDocument(data, path, merge);
        return document;
    }

    refreshDocument()
    {
        // emit an event to indicate the active document has changed in place.
        this.emit<IActiveDocumentEvent>({ type: "active-component", previous: null, next: this.activeComponent });
    }

    appendModel(modelPath: string, quality: string): CVDocument
    {
        const document = this.activeComponent;
        if (!document) {
            throw new Error("no active document, can't append model");
        }

        document.appendModel(modelPath, quality);
        return document;
    }

    appendGeometry(geoPath: string, colorMapPath?: string,
                   occlusionMapPath?: string, normalMapPath?: string, quality?: string)
    {
        const document = this.activeComponent;
        if (!document) {
            throw new Error("no active document, can't append geometry");
        }

        document.appendGeometry(geoPath, colorMapPath, occlusionMapPath, normalMapPath, quality);
        return document;
    }

    removeActiveDocument()
    {
        const document = this.activeComponent;
        if (document) {
            document.dispose();
        }
    }

    protected activateComponent(document: CVDocument)
    {
        document.ins.visible.setValue(true);
        document.ins.active.setValue(true);
    }

    protected deactivateComponent(document: CVDocument)
    {
        document.ins.visible.setValue(false);
        document.ins.active.setValue(false);

    }

    protected onActiveComponent(previous: CVDocument, next: CVDocument)
    {
        this.outs.activeDocument.setValue(next);
    }

    protected onScopedComponents()
    {
        this.outs.changedDocuments.set();
    }
}