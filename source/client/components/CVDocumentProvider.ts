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

import CVDocument, { IDocument } from "./CVDocument";

////////////////////////////////////////////////////////////////////////////////

export { EDocumentState };

export type IActiveDocumentEvent = IActiveComponentEvent<CVDocument>;
export type IDocumentsEvent = IScopedComponentsEvent;

/**
 * Owns a single, persistent document. The document component is created once
 * (see ensureDocument) and exists for the lifetime of the system; loading a
 * document repopulates it in place (see openDocument) rather than creating a new
 * one, so the document object, its CVSetup and its viewer are stable.
 *
 * The lifecycle state (outs.state) is driven explicitly by the load methods
 * (setLoading / setReady / setError). "Ready" means the scene graph is built and
 * interactable; model derivative quality is a separate concern (see setReady).
 */
export default class CVDocumentProvider extends CComponentProvider<CVDocument>
{
    static readonly typeName: string = "CVDocumentProvider";
    static readonly componentType = CVDocument;
    static readonly isSystemSingleton = true;

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

    /** The single persistent document (alias of activeComponent). */
    get document() {
        return this.activeComponent;
    }

    /**
     * Ensures the single persistent document exists, creating it empty on the
     * first call and returning the existing one thereafter. The document is
     * never replaced, so callers may keep a reference to it.
     */
    ensureDocument(): CVDocument
    {
        const document = this.activeComponent || this.node.createComponent(CVDocument);
        if (this.activeComponent !== document) {
            this.activeComponent = document;
        }
        this.updateState();
        return document;
    }

    /**
     * Loads document data into the persistent document, replacing its scene
     * content in place (the document object, its CVSetup and viewer instances
     * are kept). This does not create a new document.
     */
    openDocument(data: IDocument, path?: string): CVDocument
    {
        const document = this.ensureDocument();
        document.openDocument(data, path);
        this.updateState();
        return document;
    }

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
        // the persistent document always exists, so "not loading, not error"
        // means the scene graph is built and interactable
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
        this.updateState();
    }

    protected onScopedComponents()
    {
        this.outs.changedDocuments.set();
    }
}