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

import Component, { types } from "@ff/graph/Component";
import Property from "@ff/graph/Property";
import { IPulseContext } from "@ff/graph/components/CPulse";

import CVDocument from "./CVDocument";
import CVDocumentObserver from "./CVDocumentObserver";
import CVAssetManager from "./CVAssetManager";

////////////////////////////////////////////////////////////////////////////////

/**
 * A function reporting unsaved state that lives outside the document, such as
 * the article body held by the TinyMCE editor. Registered by whoever owns that
 * state via [[CVSaveState.addDirtyProvider]].
 */
export type DirtyProvider = () => boolean;

/**
 * Tracks whether the document has been edited since it was last saved.
 *
 * Edits are observed where they happen: every property change already sets a
 * changed flag that Graph.tick() clears at a known point each frame, so a hook
 * placed just before that reset sees every edit, whatever made it - the
 * inspector, a task, or a script. Nothing is serialized and nothing is polled;
 * the cost is proportional to what actually changed in the frame.
 *
 * Comparing serialized documents instead was tried twice - Smithsonian PR #382
 * and the first draft of this component - and fails in both directions. It
 * misses edits the serializer drops (setup features are written from a cache
 * refreshed only on load and on screenshot capture, so a background colour
 * change never reaches the bytes), it reports load-time settling as an edit,
 * and it costs a full document walk on a timer.
 *
 * This is phase 1a of the edit journal: the hook records only that something
 * changed. Phase 1b records the values too, at which point dirty becomes
 * "journal pointer differs from the pointer at save time" and undoing back to
 * the save point correctly reads clean again.
 */
export default class CVSaveState extends CVDocumentObserver
{
    static readonly typeName: string = "CVSaveState";
    static readonly isSystemSingleton = true;

    /** Seconds of asset-manager quiet required before edits start counting. */
    protected static readonly armDelay = 0.5;
    /** Hard cap on arming, in case the loading manager never reports idle. */
    protected static readonly armTimeout = 15;

    /**
     * Properties that carry runtime state on an otherwise serialized component.
     * They are written by ordinary viewer interaction and are not part of what
     * a save records, so a change to one is not an edit.
     */
    protected static readonly runtimeOnly = [
        "Camera.IsInUse",
        "Navigation.PromptActive",
    ];

    protected static readonly ins = {
        markSaved: types.Event("State.MarkSaved"),
    };

    protected static readonly outs = {
        dirty: types.Boolean("State.Dirty"),
    };

    ins = this.addInputs(CVSaveState.ins);
    outs = this.addOutputs(CVSaveState.outs);

    private _document: CVDocument = null;
    private _armed = false;
    private _armTime = -1;
    private _armDeadline = 0;
    private _suspendCount = 0;
    private _suspendUntilFrame = -1;
    private _frame = 0;
    private _providers: DirtyProvider[] = [];

    protected get assetManager() {
        return this.getMainComponent(CVAssetManager);
    }

    /** True once load has settled and edits are being counted. */
    get isTracking() {
        return this._armed;
    }

    create()
    {
        super.create();
        this.startObserving();
    }

    dispose()
    {
        this.detach(this._document);
        this.stopObserving();
        this._providers.length = 0;
        super.dispose();
    }

    /**
     * Registers a source of unsaved state that is not part of the document.
     * The provider must be removed again when its owner goes away.
     */
    addDirtyProvider(provider: DirtyProvider)
    {
        if (this._providers.indexOf(provider) < 0) {
            this._providers.push(provider);
        }
    }

    removeDirtyProvider(provider: DirtyProvider)
    {
        const index = this._providers.indexOf(provider);
        if (index >= 0) {
            this._providers.splice(index, 1);
        }
    }

    /**
     * Stops counting changes as edits until the matching resume(). Use it around
     * changes the tool makes to its own chrome - activating a task hides the grid
     * and restores it afterwards, which is not something the user did. Nests.
     */
    suspend()
    {
        ++this._suspendCount;
    }

    resume()
    {
        if (this._suspendCount > 0 && --this._suspendCount === 0) {
            // The writes happened synchronously, but the changed flags they set
            // are not read until the next tick - after this call. Hold the
            // suspension over that frame too, or the chrome lands as an edit.
            this._suspendUntilFrame = this._frame + 1;
        }
    }

    protected get isSuspended() {
        return this._suspendCount > 0 || this._frame <= this._suspendUntilFrame;
    }

    /**
     * Accepts the current state as saved. Call after a save completes, not when
     * it is issued, so a failed upload leaves the document marked unsaved.
     */
    markSaved()
    {
        this.outs.dirty.setValue(false);
    }

    /** True when leaving now would lose work. */
    isDirty(): boolean
    {
        if (this.outs.dirty.value) {
            return true;
        }

        for (let i = 0, n = this._providers.length; i < n; ++i) {
            if (this._providers[i]()) {
                return true;
            }
        }

        return false;
    }

    update()
    {
        if (this.ins.markSaved.changed) {
            this.markSaved();
        }

        return true;
    }

    tick(context: IPulseContext)
    {
        this._frame = context.frameNumber;

        if (this._armed || !this._document) {
            return false;
        }

        const elapsed = context.secondsElapsed;

        if (this._armTime < 0) {
            this._armTime = elapsed + CVSaveState.armDelay;
            this._armDeadline = elapsed + CVSaveState.armTimeout;
        }

        // Opening a document writes every property it restores, so edits only
        // start counting once loading has settled. The deadline keeps a loading
        // manager that never reports idle - a failed asset request is enough -
        // from disabling tracking altogether.
        if (this.assetManager.outs.busy.value && elapsed < this._armDeadline) {
            this._armTime = elapsed + CVSaveState.armDelay;
        }

        if (elapsed >= this._armTime) {
            this._armed = true;
        }

        return false;
    }

    protected onActiveDocument(previous: CVDocument, next: CVDocument)
    {
        this.detach(previous);

        this._document = next;
        this._armed = false;
        this._suspendUntilFrame = -1;
        this._armTime = -1;
        this._armDeadline = 0;
        this.outs.dirty.setValue(false);

        this.attach(next);
    }

    /**
     * Document state is spread over two graphs: the scene and its setup live in
     * the document's inner graph, while title, intro and copyright are inputs of
     * the document component itself, which sits in the graph above.
     */
    protected attach(document: CVDocument)
    {
        if (document) {
            document.innerGraph.changeObserver = this.onComponentChanged;
            document.graph.changeObserver = this.onComponentChanged;
        }
    }

    protected detach(document: CVDocument)
    {
        if (document) {
            if (document.innerGraph.changeObserver === this.onComponentChanged) {
                document.innerGraph.changeObserver = null;
            }
            if (document.graph.changeObserver === this.onComponentChanged) {
                document.graph.changeObserver = null;
            }
        }
    }

    protected onComponentChanged = (component: Component) =>
    {
        if (this.outs.dirty.value || !this._armed || this.isSuspended) {
            return;
        }

        const document = this._document;
        if (!document || (component !== document && component.graph !== document.innerGraph)) {
            return;
        }

        const properties = component.ins.properties;
        for (let i = 0, n = properties.length; i < n; ++i) {
            if (this.isEdit(properties[i])) {
                if (ENV_DEVELOPMENT) {
                    console.log("CVSaveState - edited: %s.%s",
                        (component.constructor as typeof Component).typeName, properties[i].path);
                }

                this.outs.dirty.setValue(true);
                return;
            }
        }
    };

    /**
     * Whether a changed property represents an edit to the document.
     *
     * Events are triggers rather than state, and object-valued properties are
     * not serialized - the same test CVSnapshots applies when choosing what a
     * snapshot may capture. A property fed by a link carries a derived value:
     * orbiting the camera drives the lights rotation through such a link, which
     * is what made navigation look like editing in earlier attempts. The link
     * test covers element-wise links too, so hasMainInLinks() is not enough.
     */
    protected isEdit(property: Property): boolean
    {
        return property.changed
            && !property.schema.event
            && property.type !== "object"
            && property.inLinks.length === 0
            && CVSaveState.runtimeOnly.indexOf(property.path) < 0;
    }
}
