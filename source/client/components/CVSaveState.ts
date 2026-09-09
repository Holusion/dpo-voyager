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
import { IPulseContext } from "@ff/graph/components/CPulse";

import CVDocument from "./CVDocument";
import CVDocumentObserver from "./CVDocumentObserver";

////////////////////////////////////////////////////////////////////////////////

/**
 * A function reporting unsaved state that lives outside the document, such as
 * the article body held by the TinyMCE editor. Registered by whoever owns that
 * state via [[CVSaveState.addDirtyProvider]].
 */
export type DirtyProvider = () => boolean;

/**
 * Tracks whether the active document differs from the last state written to disk.
 *
 * The signature of a document is the exact JSON the save path would produce, so
 * "dirty" means precisely "saving now would change the file". That makes the
 * signal honest about serialization: an edit the serializer drops does not show
 * up here, which is a true statement about what a save would preserve.
 *
 * This is phase 0 of the edit journal. Once property changes are journaled, the
 * journal pointer becomes the primary signal (it is O(1), and it catches edits
 * that never reach serialization) and the signature stays on as a cross-check.
 */
export default class CVSaveState extends CVDocumentObserver
{
    static readonly typeName: string = "CVSaveState";
    static readonly isSystemSingleton = true;

    /** Seconds between signature comparisons. */
    protected static readonly pollInterval = 0.5;
    /** Consecutive unchanged polls required before a baseline is accepted. */
    protected static readonly stablePolls = 3;

    protected static readonly ins = {
        markSaved: types.Event("State.MarkSaved"),
    };

    protected static readonly outs = {
        dirty: types.Boolean("State.Dirty"),
    };

    ins = this.addInputs(CVSaveState.ins);
    outs = this.addOutputs(CVSaveState.outs);

    private _baseline: string = null;
    private _candidate: string = null;
    private _stableCount = 0;
    private _nextPoll = 0;
    private _providers: DirtyProvider[] = [];

    /** True once a baseline has been taken and comparisons are meaningful. */
    get isTracking() {
        return this._baseline !== null;
    }

    create()
    {
        super.create();
        this.startObserving();
    }

    dispose()
    {
        this.stopObserving();
        this._providers.length = 0;
        super.dispose();
    }

    /**
     * Registers a source of unsaved state the document signature cannot see.
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
     * The JSON a save would write for the active document, or null if there is
     * nothing to save. Rounding matches CVStoryApplication's save path, so float
     * noise from navigation cannot register as an edit.
     */
    signature(): string
    {
        const document = this.activeDocument;
        if (!document || document.isEmpty()) {
            return null;
        }

        try {
            return JSON.stringify(document.deflateDocument(), (key, value) =>
                typeof value === "number" ? parseFloat(value.toFixed(7)) : value);
        }
        catch (error) {
            // A document mid-load can fail to serialize; treat it as "nothing known yet"
            // rather than reporting a change we cannot substantiate.
            console.warn("CVSaveState.signature - %s", error.message);
            return null;
        }
    }

    /**
     * Accepts the current state as saved. Call after a save completes, not when
     * it is issued, so a failed upload leaves the document marked unsaved.
     */
    markSaved()
    {
        this._baseline = this.signature();
        this._candidate = null;
        this._stableCount = 0;
        this.outs.dirty.setValue(false);
    }

    /**
     * True when leaving now would lose work. False while the baseline is still
     * settling: a document that has not finished loading has no edits to lose,
     * and warning about one would be the unconditional prompt all over again.
     */
    isDirty(): boolean
    {
        return this.dirtyFor(this._baseline === null ? null : this.signature());
    }

    protected dirtyFor(signature: string): boolean
    {
        for (let i = 0, n = this._providers.length; i < n; ++i) {
            if (this._providers[i]()) {
                return true;
            }
        }

        return this._baseline !== null && signature !== null && signature !== this._baseline;
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
        const elapsed = context.secondsElapsed;
        if (elapsed < this._nextPoll) {
            return false;
        }

        this._nextPoll = elapsed + CVSaveState.pollInterval;

        const signature = this.signature();
        if (signature === null) {
            return false;
        }

        // A freshly opened document keeps moving for a while on its own: geometry
        // sets the bounding box toDocument() writes, and linked properties such as
        // the lights rotation driven by the camera orbit settle a few frames later.
        // Waiting for the signature itself to hold still covers both, and cannot
        // stall the way a loading flag can.
        if (this._baseline === null) {
            if (signature === this._candidate) {
                if (++this._stableCount >= CVSaveState.stablePolls) {
                    this._baseline = signature;
                    this._candidate = null;
                    this._stableCount = 0;
                    this.outs.dirty.setValue(false);
                }
            }
            else {
                this._candidate = signature;
                this._stableCount = 0;
            }

            return false;
        }

        const wasDirty = this.outs.dirty.value;
        const isDirty = this.dirtyFor(signature);

        if (isDirty !== wasDirty) {
            this.outs.dirty.setValue(isDirty);

            if (ENV_DEVELOPMENT && isDirty) {
                this.reportDivergence();
            }
        }

        return false;
    }

    protected onActiveDocument(previous: CVDocument, next: CVDocument)
    {
        this._baseline = null;
        this._candidate = null;
        this._stableCount = 0;
        this.outs.dirty.setValue(false);
    }

    /**
     * Logs where the document first diverges from the baseline. The signature can
     * only say that something changed; this says what, which is what you want when
     * the answer is surprising - an edit that should have registered and did not,
     * or churn from a component nobody touched.
     */
    protected reportDivergence()
    {
        const signature = this.signature();
        const baseline = this._baseline;

        if (signature === null || baseline === null) {
            return;
        }

        let at = 0;
        const limit = Math.min(signature.length, baseline.length);
        while (at < limit && signature[at] === baseline[at]) {
            ++at;
        }

        const from = Math.max(0, at - 60);
        console.log("CVSaveState - document diverged from saved state at offset %s", at);
        console.log("  saved: …%s", baseline.substring(from, at + 60));
        console.log("  now:   …%s", signature.substring(from, at + 60));
    }
}
