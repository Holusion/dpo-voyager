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

import { EDocumentState } from "client/schema/document";

import CVAssetManager from "./CVAssetManager";
import CVDocument, { IDocument } from "./CVDocument";

////////////////////////////////////////////////////////////////////////////////

export { EDocumentState };

export type IActiveDocumentEvent = IActiveComponentEvent<CVDocument>;
export type IDocumentsEvent = IScopedComponentsEvent;

/**
 * Owns the lifecycle of the active document. There is exactly one active
 * document at a time; switching documents always builds a fresh scene graph
 * (see createDocument) and disposes the previous one.
 *
 * This provider is a *system* component (it lives in the main graph and
 * outlives every document). The scene graph it manages lives inside
 * CVDocument.innerGraph and is created/destroyed per document. See
 * docs/architecture-lifecycle.md for the full contract.
 */
export default class CVDocumentProvider extends CComponentProvider<CVDocument>
{
    static readonly typeName: string = "CVDocumentProvider";
    static readonly componentType = CVDocument;

    // document-independent system component: exactly one per system
    static readonly isSystemSingleton = true;

    protected static readonly outs = {
        activeDocument: types.Object("Documents.Active", CVDocument),
        changedDocuments: types.Event("Documents.Changed"),
        state: types.Enum("Documents.State", EDocumentState, EDocumentState.Initializing),
    };

    outs = this.addOutputs(CVDocumentProvider.outs);

    // set true when the last load failed; cleared when the next load starts
    private _error = false;

    constructor(node: Node, id: string)
    {
        super(node, id);
        this.scope = EComponentScope.Node;
    }

    protected get assetManager() {
        return this.getMainComponent(CVAssetManager);
    }

    create()
    {
        super.create();

        // derive the lifecycle state from the existing loading signals
        const assetManager = this.assetManager;
        assetManager.outs.initialLoad.on("value", this.recomputeState, this);
        assetManager.outs.busy.on("value", this.recomputeState, this);
    }

    dispose()
    {
        const assetManager = this.assetManager;
        assetManager.outs.initialLoad.off("value", this.recomputeState, this);
        assetManager.outs.busy.off("value", this.recomputeState, this);

        super.dispose();
    }

    /**
     * Builds a brand-new document and makes it the active one, disposing the
     * previously active document (and its entire scene graph) afterwards. This
     * is the single entry point for switching scenes; the swap is atomic so the
     * renderer never observes a half-built graph.
     */
    createDocument(data?: IDocument, path?: string)
    {
        const previous = this.activeComponent;

        // the new document is constructed inactive/hidden, so it is neither
        // rendered nor ticked until it becomes the active component
        const document = this.node.createComponent(CVDocument);
        if (data) {
            document.openDocument(data, path);
        }

        // atomic switch: deactivates the previous document, activates the new one
        this.activeComponent = document;

        // tear down the old document only once the new one is active
        if (previous) {
            previous.dispose();
        }

        return document;
    }

    /**
     * Flags that the last load failed. The state is reset to a loading or ready
     * state the next time a document load starts.
     */
    setError()
    {
        this._error = true;
        this.recomputeState();
    }

    protected recomputeState()
    {
        const assetManager = this.assetManager;
        let state: EDocumentState;

        if (assetManager.outs.initialLoad.value) {
            // a new load is in flight: clear any previous error
            this._error = false;
            state = EDocumentState.Loading;
        }
        else if (this._error) {
            state = EDocumentState.Error;
        }
        else if (this.activeComponent) {
            state = EDocumentState.Ready;
        }
        else {
            state = EDocumentState.Initializing;
        }

        this.outs.state.setValue(state);
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
        // track the precise "interactable" signal of the active document's viewer
        if (previous) {
            previous.setup.viewer.outs.sceneLoaded.off("value", this.recomputeState, this);
        }
        if (next) {
            next.setup.viewer.outs.sceneLoaded.on("value", this.recomputeState, this);
        }

        this.outs.activeDocument.setValue(next);
        this.recomputeState();
    }

    protected onScopedComponents()
    {
        this.outs.changedDocuments.set();
    }
}