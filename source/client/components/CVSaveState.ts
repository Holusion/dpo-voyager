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

import EditJournal, { valuesEqual } from "../utils/EditJournal";

import CVDocument from "./CVDocument";
import CVDocumentObserver from "./CVDocumentObserver";
import CVAssetManager from "./CVAssetManager";
import CVModel2 from "./CVModel2";

////////////////////////////////////////////////////////////////////////////////

/**
 * A function reporting unsaved state that lives outside the document, such as
 * the article body held by the TinyMCE editor. Registered by whoever owns that
 * state via [[CVSaveState.addDirtyProvider]].
 */
export type DirtyProvider = () => boolean;

/**
 * Records document edits, and answers whether there is unsaved work.
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
 * The observer sees a property after it has changed, so a shadow copy of every
 * tracked value is kept alongside: that copy is the "before" of the next edit,
 * and it is also what makes the record survive PropertyField writing through
 * property.value in place before committing.
 *
 * Undo is therefore the same mechanism read backwards, and "dirty" is a pointer
 * comparison rather than a flag - undoing back to the save point reads clean.
 * What the hook cannot see is structural change: adding or removing an
 * annotation, creating or disposing a node, reordering a list. Those still mark
 * the document unsaved (see [[_unjournaled]]) but cannot yet be taken back.
 */
export default class CVSaveState extends CVDocumentObserver
{
    static readonly typeName: string = "CVSaveState";
    static readonly isSystemSingleton = true;

    /** Seconds of quiet from loading required before edits start counting. */
    protected static readonly armDelay = 0.5;
    /** Hard cap on arming, in case the loading manager never reports idle. */
    protected static readonly armTimeout = 15;

    /**
     * Frames an undo or redo is given to settle before changes count as edits
     * again. Restoring a value can start a chain that takes several frames to
     * run out - putting the scene units back rescales the model hierarchy, and
     * that rescale lands two ticks later - and none of it is a new edit.
     */
    protected static readonly undoSettleFrames = 4;

    /**
     * Properties that carry runtime state on an otherwise serialized component.
     * They are written by ordinary viewer interaction and are not part of what
     * a save records, so a change to one is not an edit.
     */
    protected static readonly runtimeOnly = [
        "Camera.IsInUse",
        "Navigation.PromptActive",
        // Which article the reader has focus on; CVReader.toData() saves the
        // reader's enabled state and position, never this.
        "Reader.Focus",
        // A trigger rather than state: navigation applies the preset to the
        // orbit and immediately writes the property back to None, so there is
        // nothing here for undo to hold on to. What it moves is the camera,
        // which the journal leaves alone in any case.
        "Camera.ViewPreset",
    ];

    protected static readonly ins = {
        markSaved: types.Event("State.MarkSaved"),
        undo: types.Event("State.Undo"),
        redo: types.Event("State.Redo"),
    };

    protected static readonly outs = {
        dirty: types.Boolean("State.Dirty"),
        canUndo: types.Boolean("State.CanUndo"),
        canRedo: types.Boolean("State.CanRedo"),
    };

    ins = this.addInputs(CVSaveState.ins);
    outs = this.addOutputs(CVSaveState.outs);

    readonly journal = new EditJournal();

    private _document: CVDocument = null;
    private _armed = false;
    private _armTime = -1;
    private _armDeadline = 0;
    private _suspendCount = 0;
    private _suspendUntilFrame = -1;
    private _deferred = new Set<Component>();
    private _deferBlanket = false;
    private _frame = 0;
    private _providers: DirtyProvider[] = [];

    /** Last known value of every tracked property, keyed by the property. */
    private _shadow = new Map<Property, any>();
    /** Set by an edit the journal could not record, so undo cannot clear it. */
    private _unjournaled = false;

    protected get assetManager() {
        return this.getMainComponent(CVAssetManager);
    }

    /** True once load has settled and edits are being counted. */
    get isTracking() {
        return this._armed;
    }

    /**
     * True when an edit was seen that the journal has no baseline for, so undo
     * cannot take it back. Only cleared by saving.
     */
    get hasUnjournaledEdits() {
        return this._unjournaled;
    }

    get canUndo() {
        return this._armed && this.journal.canUndo;
    }

    get canRedo() {
        return this._armed && this.journal.canRedo;
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
        this._shadow.clear();
        this._deferred.clear();
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
     *
     * The shadow copy is still maintained while suspended, so the next real edit
     * still knows the value it started from.
     */
    suspend()
    {
        if (!this.isSuspended) {
            // Anything already marked changed was written before this bracket
            // opened, so it belongs in the journal. Record it now, or a task
            // that suspends in the same frame as a real edit swallows it.
            this.flushPending();
        }

        ++this._suspendCount;
    }

    resume()
    {
        if (this._suspendCount > 0 && --this._suspendCount === 0) {
            this.deferSuspension();
        }
    }

    protected get isSuspended() {
        return this._suspendCount > 0 || this._frame <= this._suspendUntilFrame;
    }

    /**
     * Carries the suspension into the following frame, but only for the
     * components that will react in it.
     *
     * The writes inside the bracket happened synchronously; the changed flags
     * they set are not read until the next tick, and the components those
     * writes reach have still to run their own update() - which is where the
     * second wave lands. A component already marked changed here is one of
     * those, and nothing else is. Suspending the whole next frame instead - the
     * first version of this - loses any edit the user makes in it, which is how
     * a colour change made while a model was still settling went missing.
     */
    protected deferSuspension()
    {
        const document = this._document;

        this._deferred.clear();
        this._deferBlanket = false;
        this._suspendUntilFrame = this._frame + 1;

        if (!this._armed || !document) {
            return;
        }

        const components = document.innerGraph.components.getArray();
        for (let i = 0, n = components.length; i < n; ++i) {
            if (components[i].changed) {
                // Absorb what is already written, so only the reaction is left
                // for the deferred suspension to hide.
                this.processComponent(components[i], true);
                this._deferred.add(components[i]);
            }
        }

        if (document.changed) {
            this.processComponent(document, true);
            this._deferred.add(document);
        }
    }

    /**
     * Accepts the current state as saved. Call after a save completes, not when
     * it is issued, so a failed upload leaves the document marked unsaved.
     */
    markSaved()
    {
        this.journal.markSaved();
        this._unjournaled = false;
        this.updateOutputs();
    }

    /**
     * Marks the start of a new user action: a pointer going down, a key going
     * down, a field committed. Two things follow from that. The entry changes
     * were joining is closed, so the next one becomes its own undo step. And
     * the settle window an undo leaves behind is ended - it is there to absorb
     * the machine's reaction to a restored value, and the user acting is proof
     * that reaction is over.
     */
    commitEdit()
    {
        this.journal.commit();

        if (this._deferBlanket) {
            this._deferBlanket = false;
            this._suspendUntilFrame = -1;
        }
    }

    undo(): boolean
    {
        if (!this.canUndo) {
            return false;
        }

        const entry = this.applyJournal(() => this.journal.undo());

        if (ENV_DEVELOPMENT && entry) {
            console.log(`CVSaveState - undo: ${entry.name}`);
        }

        return !!entry;
    }

    redo(): boolean
    {
        if (!this.canRedo) {
            return false;
        }

        const entry = this.applyJournal(() => this.journal.redo());

        if (ENV_DEVELOPMENT && entry) {
            console.log(`CVSaveState - redo: ${entry.name}`);
        }

        return !!entry;
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
        const ins = this.ins;

        if (ins.markSaved.changed) {
            this.markSaved();
        }
        if (ins.undo.changed) {
            this.undo();
        }
        if (ins.redo.changed) {
            this.redo();
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
        const loading = this.assetManager.outs.busy.value || this.isLoadingModels();

        if (loading && elapsed < this._armDeadline) {
            this._armTime = elapsed + CVSaveState.armDelay;
        }

        if (elapsed >= this._armTime) {
            // Whatever the document holds now is the state a save would write,
            // so it is also the baseline the first edit is measured against.
            this.seedShadow();
            this._armed = true;
        }

        return false;
    }

    /**
     * The asset manager going quiet is not the end of loading: a model that has
     * its file still settles on a derivative afterwards and writes its own
     * quality doing so, which arriving one moment too early records as an edit.
     */
    protected isLoadingModels(): boolean
    {
        const models = this._document.innerGraph.components.getArray(CVModel2);

        for (let i = 0, n = models.length; i < n; ++i) {
            if (models[i].isLoading()) {
                return true;
            }
        }

        return false;
    }

    protected onActiveDocument(previous: CVDocument, next: CVDocument)
    {
        this.detach(previous);

        this._document = next;
        this._armed = false;
        this._suspendUntilFrame = -1;
        this._deferred.clear();
        this._deferBlanket = false;
        this._armTime = -1;
        this._armDeadline = 0;
        this._unjournaled = false;
        this._shadow.clear();
        this.journal.clear();
        this.updateOutputs();

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
        if (!this._armed) {
            return;
        }

        const document = this._document;
        if (!document || (component !== document && component.graph !== document.innerGraph)) {
            return;
        }

        const suspended = this._suspendCount > 0
            || (this._frame <= this._suspendUntilFrame
                && (this._deferBlanket || this._deferred.has(component)));

        this.processComponent(component, suspended);
    };

    /**
     * Records everything that has changed but has not been observed yet. Called
     * when a suspension opens, so the writes that preceded it are not lost with
     * the ones it is there to hide.
     */
    protected flushPending()
    {
        const document = this._document;

        if (!this._armed || !document) {
            return;
        }

        const components = document.innerGraph.components.getArray();
        for (let i = 0, n = components.length; i < n; ++i) {
            if (components[i].changed) {
                this.processComponent(components[i], false);
            }
        }

        if (document.changed) {
            this.processComponent(document, false);
        }
    }

    protected processComponent(component: Component, suspended: boolean)
    {
        const shadow = this._shadow;
        const properties = component.ins.properties;

        for (let i = 0, n = properties.length; i < n; ++i) {
            const property = properties[i];

            if (!this.isTracked(property)) {
                continue;
            }

            if (!property.changed) {
                // Seen for the first time on a component created after arming.
                if (!shadow.has(property)) {
                    shadow.set(property, property.cloneValue());
                }
                continue;
            }

            const known = shadow.has(property);
            const before = shadow.get(property);
            const after = property.cloneValue();
            shadow.set(property, after);

            if (suspended || !this.isEdit(property) || valuesEqual(before, after)) {
                continue;
            }

            if (ENV_DEVELOPMENT) {
                console.log(`CVSaveState - edited: ${(component.constructor as typeof Component).typeName}.${property.path}`);
            }

            if (known) {
                this.journal.record(property, before, after, this.now());
            }
            else {
                // No baseline to undo to - this property belongs to something
                // created since the last save. The document is still dirty.
                this._unjournaled = true;
            }
        }

        this.updateOutputs();
    }

    /** Runs an undo or a redo without the resulting writes counting as edits. */
    protected applyJournal(apply: () => ReturnType<EditJournal["undo"]>)
    {
        this.suspend();
        let entry: ReturnType<EditJournal["undo"]>;
        try {
            entry = apply();
        }
        finally {
            this.resume();

            // resume() covers the components that are about to react, for one
            // frame. An undo needs more than that: the chain it sets off runs
            // for several ticks and reaches components that are not marked
            // changed yet, so hold everything until it has run out.
            this._deferred.clear();
            this._deferBlanket = true;
            this._suspendUntilFrame = this._frame + CVSaveState.undoSettleFrames;
        }

        this.updateOutputs();
        return entry;
    }

    protected updateOutputs()
    {
        const outs = this.outs;
        outs.dirty.setValue(this.journal.isDirty || this._unjournaled);
        outs.canUndo.setValue(this.canUndo);
        outs.canRedo.setValue(this.canRedo);
    }

    protected now(): number
    {
        return typeof performance !== "undefined" ? performance.now() : Date.now();
    }

    /**
     * Takes the baseline the first edit will be compared against. Components
     * added later are picked up lazily by the observer.
     */
    protected seedShadow()
    {
        const document = this._document;
        if (!document) {
            return;
        }

        this._shadow.clear();

        const components = document.innerGraph.components.getArray();
        for (let i = 0, n = components.length; i < n; ++i) {
            this.seedComponent(components[i]);
        }

        this.seedComponent(document);
    }

    protected seedComponent(component: Component)
    {
        const properties = component.ins.properties;
        for (let i = 0, n = properties.length; i < n; ++i) {
            const property = properties[i];
            if (this.isTracked(property)) {
                this._shadow.set(property, property.cloneValue());
            }
        }
    }

    /**
     * Whether a property holds a value worth remembering. Events are triggers
     * rather than state, and object-valued properties are not serialized - the
     * same test CVSnapshots applies when choosing what a snapshot may capture.
     */
    protected isTracked(property: Property): boolean
    {
        return !property.schema.event && property.type !== "object";
    }

    /**
     * Whether a changed property represents an edit to the document.
     *
     * A property fed by a link carries a derived value: orbiting the camera
     * drives the lights rotation through such a link, which is what made
     * navigation look like editing in earlier attempts. The link test covers
     * element-wise links too, so hasMainInLinks() is not enough.
     */
    protected isEdit(property: Property): boolean
    {
        return property.changed
            && this.isTracked(property)
            && property.inLinks.length === 0
            && CVSaveState.runtimeOnly.indexOf(property.path) < 0;
    }
}
