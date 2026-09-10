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
import { propertyNaming } from "../utils/describeEdit";
import EditMetrics from "../utils/editMetrics";

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
 *
 * Not every property write is an edit. A model finishing its load rewrites the
 * floor, the lights and the camera frustum from the new bounds; a task hides
 * the grid while it is active. Those writes are bracketed at the site that
 * makes them ([[withoutEdits]], [[suspend]]), which marks the properties they
 * touch so the observer skips them (see [[_derived]]). The marks are scoped to
 * the individual properties and last only until the observer has seen them, so
 * a real edit to a different property of the same component in the same frame
 * still lands in the journal.
 */
export default class CVSaveState extends CVDocumentObserver
{
    static readonly typeName: string = "CVSaveState";
    static readonly isSystemSingleton = true;

    /** Seconds of quiet from loading required before edits start counting. */
    protected static readonly armDelay = 0.5;

    protected static readonly ins = {
        markSaved: types.Event("State.MarkSaved"),
        undo: types.Event("State.Undo"),
        redo: types.Event("State.Redo"),
    };

    protected static readonly outs = {
        dirty: types.Boolean("State.Dirty"),
        canUndo: types.Boolean("State.CanUndo"),
        canRedo: types.Boolean("State.CanRedo"),
        // What the next press would take back or reapply, in words, for a
        // button label or tooltip. Empty when there is nothing to press.
        undoTitle: types.String("State.UndoTitle"),
        redoTitle: types.String("State.RedoTitle"),
    };

    ins = this.addInputs(CVSaveState.ins);
    outs = this.addOutputs(CVSaveState.outs);

    readonly journal = new EditJournal(undefined, propertyNaming);

    /** INSTRUMENTATION. What edit detection costs; see utils/editMetrics. */
    readonly metrics = new EditMetrics();

    private _document: CVDocument = null;
    private _armed = false;
    private _armTime = -1;
    private _frame = 0;
    private _providers: DirtyProvider[] = [];

    /** Depth of open withoutEdits()/suspend() brackets. */
    private _captureDepth = 0;
    /**
     * The tracked properties already marked changed when the outermost bracket
     * opened. Anything changed by the time it closes that is not in here was
     * written by the bracket, so it is a derived recompute rather than an edit
     * the user had in flight.
     */
    private _capturePending: Set<Property> = null;
    /**
     * Properties whose next observed change is a derived recompute, each stamped
     * with the frame the mark was made. The observer consumes a mark when it
     * sees the change - which is the same tick for a component it has not
     * reached yet, the next tick for one it has - and tick() sweeps a mark that
     * is older than that, so a mark never outlives the reaction it stands for.
     */
    private _derived = new Map<Property, number>();

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

    /** What an undo would take back, in words. Empty when there is nothing. */
    get undoTitle() {
        return this.canUndo ? this.journal.undoTitle : "";
    }

    /** What a redo would reapply, in words. Empty when there is nothing. */
    get redoTitle() {
        return this.canRedo ? this.journal.redoTitle : "";
    }

    create()
    {
        super.create();

        // INSTRUMENTATION. Read only when a report is asked for.
        this.metrics.holdings = () => ({
            shadow: this._shadow.size,
            entries: this.journal.length,
            records: this.journal.log.reduce((n, e) => n + e.records.length, 0),
        });

        this.startObserving();
    }

    dispose()
    {
        this.detach(this._document);
        this.stopObserving();
        this._providers.length = 0;
        this._shadow.clear();
        this._derived.clear();
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
     * Brackets a block whose property writes are derived, not authored: a task
     * hiding the grid while it is active, or a model finishing its load and the
     * floor, lights and cameras recomputing from the new bounds. Nests. Prefer
     * [[withoutEdits]], which is what the scene components call.
     *
     * On the way in it notes what is already dirty; on the way out it marks
     * every property the block newly touched (see [[markDerivedSince]]) so the
     * observer skips it. An edit the user had in flight when the block opened is
     * not in that set, so it still lands in the journal.
     *
     * The shadow copy is still maintained throughout, so the next real edit
     * knows the value it started from.
     */
    suspend()
    {
        const started = this.metrics.enabled ? this.metrics.now() : 0;

        if (this._captureDepth++ === 0) {
            this._capturePending = this._armed && this._document
                ? this.collectChanged() : new Set();
        }

        if (this.metrics.enabled) {
            this.metrics.addSuspend(started, this._capturePending.size);
        }
    }

    resume()
    {
        if (this._captureDepth === 0 || --this._captureDepth > 0) {
            return;
        }

        const started = this.metrics.enabled ? this.metrics.now() : 0;
        const pending = this._capturePending;
        this._capturePending = null;

        const marked = pending ? this.markDerivedSince(pending) : 0;

        if (this.metrics.enabled) {
            this.metrics.addDefer(started, marked);
        }
    }

    /** Every tracked property currently marked changed. */
    protected collectChanged(): Set<Property>
    {
        const changed = new Set<Property>();
        const document = this._document;
        if (!document) {
            return changed;
        }

        const components = document.innerGraph.components.getArray();
        for (let i = 0, n = components.length; i < n; ++i) {
            this.collectComponentChanged(components[i], changed);
        }
        this.collectComponentChanged(document, changed);

        return changed;
    }

    private collectComponentChanged(component: Component, out: Set<Property>)
    {
        if (!component.changed) {
            return;
        }
        const properties = component.ins.properties;
        for (let i = 0, n = properties.length; i < n; ++i) {
            const property = properties[i];
            // A property already marked derived is a recompute still in flight
            // from an earlier frame's bracket, not an edit the user has in
            // hand - so it is not "pending", and markDerivedSince() is free to
            // re-mark it when this bracket closes. Without this, a cascade that
            // outlives one bracket and overlaps the next leaks into the journal.
            if (property.changed && this.isTracked(property) && !this._derived.has(property)) {
                out.add(property);
            }
        }
    }

    /**
     * Marks every property a just-closed bracket wrote - anything changed now
     * that was not changed when the bracket opened - as a derived write for the
     * observer to skip.
     *
     * The write happened synchronously; its changed flag is not read until the
     * observer reaches that component, this tick or next. The mark bridges that
     * gap and no more: it is stamped with the current frame, and tick() drops
     * it once the observer has had its chance.
     */
    protected markDerivedSince(pending: Set<Property>): number
    {
        const document = this._document;
        if (!this._armed || !document) {
            return 0;
        }

        let marked = 0;
        const consider = (component: Component) => {
            if (!component.changed) {
                return;
            }
            const properties = component.ins.properties;
            for (let i = 0, n = properties.length; i < n; ++i) {
                const property = properties[i];
                if (property.changed && this.isTracked(property) && !pending.has(property)) {
                    this._derived.set(property, this._frame);
                    ++marked;
                }
            }
        };

        const components = document.innerGraph.components.getArray();
        for (let i = 0, n = components.length; i < n; ++i) {
            consider(components[i]);
        }
        consider(document);

        return marked;
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
     * any derived-write marks still standing are dropped - they are there to
     * absorb the machine's reaction to a load or an undo, and the user acting is
     * proof that reaction is over.
     */
    commitEdit()
    {
        this.journal.commit();
        this._derived.clear();
    }

    undo(): boolean
    {
        if (!this.canUndo) {
            return false;
        }

        const entry = this.applyJournal(() => this.journal.undo());

        if (ENV_DEVELOPMENT && entry) {
            console.log(`CVSaveState - undo: ${entry.title} [${entry.name}]`);
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
            console.log(`CVSaveState - redo: ${entry.title} [${entry.name}]`);
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

        // Drop derived-write marks the observer has already had a chance to
        // consume. A mark is stamped with the frame it was made and is good for
        // that frame and the next; past that it would only risk swallowing a
        // real edit to the same property.
        if (this._derived.size > 0) {
            const frame = this._frame;
            for (const [property, marked] of this._derived) {
                if (frame - marked > 1) {
                    this._derived.delete(property);
                }
            }
        }

        if (this._armed || !this._document) {
            if (this.metrics.enabled && this._armed) {
                ++this.metrics.frames;
            }
            return false;
        }

        const elapsed = context.secondsElapsed;

        if (this._armTime < 0) {
            this._armTime = elapsed + CVSaveState.armDelay;
        }

        // Opening a document writes every property it restores, so edits only
        // start counting once loading has settled. There is deliberately no
        // deadline here: a loading manager that never reports idle is a leaked
        // item somewhere in io/, and tracking staying off is the symptom that
        // says so rather than something to wait out.
        const loading = this.assetManager.outs.busy.value || this.isLoadingModels();

        if (loading) {
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
        this._captureDepth = 0;
        this._capturePending = null;
        this._derived.clear();
        this._armTime = -1;
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

        this.processComponent(component);
    };

    protected processComponent(component: Component)
    {
        const shadow = this._shadow;
        const derived = this._derived;
        const frame = this._frame;
        const properties = component.ins.properties;

        const metrics = this.metrics;
        const started = metrics.enabled ? metrics.now() : 0;
        let scanned = 0;
        let clones = 0;
        let records = 0;
        let absorbed = 0;

        for (let i = 0, n = properties.length; i < n; ++i) {
            const property = properties[i];

            if (!this.isTracked(property)) {
                continue;
            }

            ++scanned;

            if (!property.changed) {
                // Seen for the first time on a component created after arming.
                if (!shadow.has(property)) {
                    shadow.set(property, property.cloneValue());
                    ++clones;
                }
                continue;
            }

            const known = shadow.has(property);
            const before = shadow.get(property);
            const after = property.cloneValue();
            shadow.set(property, after);
            ++clones;

            const mark = derived.get(property);
            if (mark !== undefined) {
                derived.delete(property);
                if (frame - mark <= 1) {
                    // A derived recompute: the shadow now holds its result, so
                    // nothing downstream reads it as an edit either.
                    ++absorbed;
                    continue;
                }
            }

            if (!this.isEdit(property) || valuesEqual(before, after)) {
                continue;
            }

            if (ENV_DEVELOPMENT) {
                console.log(`CVSaveState - edited: ${(component.constructor as typeof Component).typeName}.${property.path}`);
            }

            if (known) {
                this.journal.record(property, before, after, this.now());
                ++records;
            }
            else {
                // No baseline to undo to - this property belongs to something
                // created since the last save. The document is still dirty.
                this._unjournaled = true;
            }
        }

        this.updateOutputs();

        if (metrics.enabled) {
            metrics.addScan(started, this._frame, scanned, clones, records, absorbed > 0);
        }
    }

    /** Runs an undo or a redo without the resulting writes counting as edits. */
    protected applyJournal(apply: () => ReturnType<EditJournal["undo"]>)
    {
        const started = this.metrics.enabled ? this.metrics.now() : 0;

        // Restoring a value is a derived write, and so is every recompute it
        // sets off - the floor following the bounds, the hierarchy rescaling
        // after a unit change. The bracket marks the restore itself; each
        // recompute site (see withoutEdits) marks its own writes as the chain
        // reaches it over the next few ticks, so nothing here has to guess how
        // long that takes.
        this.suspend();
        let entry: ReturnType<EditJournal["undo"]>;
        try {
            entry = apply();
        }
        finally {
            this.resume();
        }

        this.updateOutputs();

        if (this.metrics.enabled) {
            this.metrics.addApply(started);
        }

        return entry;
    }

    protected updateOutputs()
    {
        const outs = this.outs;

        // Property.setValue notifies whether or not the value moved, and this
        // runs once per changed component per frame - on every frame of a drag.
        // Writing only what changed keeps the task bar from re-rendering for
        // nothing.
        this.setOut(outs.dirty, this.journal.isDirty || this._unjournaled);
        this.setOut(outs.canUndo, this.canUndo);
        this.setOut(outs.canRedo, this.canRedo);
        this.setOut(outs.undoTitle, this.undoTitle);
        this.setOut(outs.redoTitle, this.redoTitle);
    }

    protected setOut<T>(property: Property, value: T)
    {
        if (property.value !== value as any) {
            property.setValue(value as any);
        }
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

        const started = this.metrics.enabled ? this.metrics.now() : 0;

        this._shadow.clear();

        const components = document.innerGraph.components.getArray();
        for (let i = 0, n = components.length; i < n; ++i) {
            this.seedComponent(components[i]);
        }

        this.seedComponent(document);

        if (this.metrics.enabled) {
            this.metrics.addSeed(started, this._shadow.size);
        }
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
     *
     * A transient property is runtime state that no save writes - which
     * article is open, whether the navigation prompt is showing - and says so
     * in its own schema. That has to be a declaration rather than something
     * derived: "absent from this component's toData" is not the same as "not
     * persisted", since a broadcast control like the viewer's quality is saved
     * through the models it writes to.
     */
    protected isEdit(property: Property): boolean
    {
        return property.changed
            && this.isTracked(property)
            && property.inLinks.length === 0
            && !property.schema.transient;
    }
}
