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

////////////////////////////////////////////////////////////////////////////////

/**
 * What the journal needs of the thing it records. Property satisfies it; the
 * indirection is what lets the journal be tested without a graph.
 */
export interface IJournalTarget
{
    readonly path: string;
    cloneValue(): any;
    copyValue(value: any, silent?: boolean): void;
}

export interface IJournalRecord
{
    target: IJournalTarget;
    before: any;
    after: any;
}

export interface IJournalEntry
{
    records: IJournalRecord[];
    /** Time of the most recent record, used to decide coalescing. */
    time: number;
    /** False once the entry may no longer absorb further records. */
    open: boolean;
    /** Compact identity of the entry, in property paths. For logs and tests. */
    name: string;
    /** What the entry changed, in words, for the person about to undo it. */
    title: string;
}

/**
 * Turns a target and its values into words. The journal knows nothing about
 * properties, so this is how the graph-side vocabulary - component names, enum
 * options, colours - gets into an entry title. See utils/describeEdit.
 */
export interface IJournalNaming
{
    /** What changed, e.g. "Floor opacity". */
    label(target: IJournalTarget): string;
    /** One value of that target, e.g. "0.25", "on", "Left". */
    value(target: IJournalTarget, value: any): string;
}

/** Naming of last resort: paths and raw values. Used when none is supplied. */
export const defaultNaming: IJournalNaming = {
    label: target => target.path,
    value: (target, value) => JSON.stringify(value),
};

/** Value equality for property values: scalars, or arrays of them. */
export function valuesEqual(a: any, b: any): boolean
{
    if (a === b) {
        return true;
    }

    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) {
            return false;
        }
        for (let i = 0, n = a.length; i < n; ++i) {
            if (a[i] !== b[i]) {
                return false;
            }
        }
        return true;
    }

    // NaN is written by more than one property in this tree; treating it as
    // unequal to itself would journal an edit every frame.
    return a !== a && b !== b;
}

/**
 * An ordered list of property changes with a pointer into it.
 *
 * Records are grouped into entries, and an entry is what one undo takes back.
 * Grouping is by time: changes arriving within [[coalesceWindow]] of the last
 * one join the entry that is already open, so a drag that writes sixty values
 * is one entry rather than sixty. [[commit]] closes the open entry early, for
 * callers that know an edit has ended.
 *
 * The pointer is also what "unsaved" means: [[markSaved]] remembers where the
 * pointer stood, and the document is dirty whenever it stands anywhere else -
 * so undoing back to the save point correctly reads clean again, which a plain
 * flag cannot do.
 */
export default class EditJournal
{
    /** Milliseconds of quiet after which the next change starts a new entry. */
    static readonly coalesceWindow = 500;
    static readonly defaultCapacity = 200;

    protected entries: IJournalEntry[] = [];
    protected naming: IJournalNaming;
    protected pointer = -1;
    protected savedPointer = -1;
    /** True once the save point has been dropped or overwritten. */
    protected savedLost = false;

    readonly capacity: number;

    constructor(capacity?: number, naming?: IJournalNaming)
    {
        this.capacity = capacity !== undefined ? capacity : EditJournal.defaultCapacity;
        this.naming = naming || defaultNaming;
    }

    get length() {
        return this.entries.length;
    }

    /** The entries, oldest first. Read-only; for inspection and tests. */
    get log(): ReadonlyArray<IJournalEntry> {
        return this.entries;
    }

    /** Index of the entry an undo would take back, -1 when there is none. */
    get position() {
        return this.pointer;
    }

    get isDirty() {
        return this.savedLost || this.pointer !== this.savedPointer;
    }

    get canUndo() {
        return this.pointer >= 0;
    }

    get canRedo() {
        return this.pointer < this.entries.length - 1;
    }

    get undoName() {
        return this.canUndo ? this.entries[this.pointer].name : null;
    }

    get redoName() {
        return this.canRedo ? this.entries[this.pointer + 1].name : null;
    }

    /**
     * What an undo would take back, in words: "Floor opacity from 0.25 to 0.9".
     * The values read in the direction the press moves them, so this is the
     * entry title with its ends swapped.
     */
    get undoTitle() {
        return this.canUndo ? this.describe(this.entries[this.pointer], true) : null;
    }

    /** What a redo would reapply, in words. Null when there is nothing ahead. */
    get redoTitle() {
        return this.canRedo ? this.describe(this.entries[this.pointer + 1], false) : null;
    }

    /**
     * Adds a change. Joins the open entry if one is still within the coalescing
     * window, otherwise starts a new one and discards anything ahead of the
     * pointer, the way any undo stack does on a fresh edit.
     */
    record(target: IJournalTarget, before: any, after: any, time: number)
    {
        const entry = this.openEntry(time);

        const records = entry.records;
        for (let i = 0, n = records.length; i < n; ++i) {
            if (records[i].target === target) {
                // Same property twice in one entry: keep the value it had when
                // the entry began, and let the newest value be the result.
                records[i].after = after;
                entry.time = time;
                entry.title = this.describe(entry, false);
                return;
            }
        }

        records.push({ target, before, after });
        entry.time = time;
        // Named after the property the entry started from: the ones that follow
        // in the same entry are almost always that edit's own consequences, so
        // "Renderer.Shader +3" says more than "4 changes".
        entry.name = records.length > 1
            ? `${records[0].target.path} +${records.length - 1}` : target.path;
        entry.title = this.describe(entry, false);
    }

    /**
     * The entry in words, reading from what it left behind to what it applied,
     * or the other way round for [[reverse]]. Multi-record entries name the
     * change they started from and count the rest: those followers are that
     * edit's own consequences, and spelling out five of them helps nobody.
     */
    protected describe(entry: IJournalEntry, reverse: boolean): string
    {
        const records = entry.records;
        if (records.length === 0) {
            return "";
        }

        const { target, before, after } = records[0];
        const label = this.naming.label(target);
        const from = this.naming.value(target, reverse ? after : before);
        const to = this.naming.value(target, reverse ? before : after);

        const rest = records.length - 1;
        const more = rest > 0 ? ` and ${rest} more change${rest > 1 ? "s" : ""}` : "";

        return `${label} from ${from} to ${to}${more}`;
    }

    /** Closes the open entry, so the next change starts a new one. */
    commit()
    {
        if (this.pointer >= 0) {
            this.entries[this.pointer].open = false;
        }
    }

    /** Reverts the entry at the pointer and steps back. Returns what it undid. */
    undo(): IJournalEntry
    {
        if (!this.canUndo) {
            return null;
        }

        const entry = this.entries[this.pointer--];
        entry.open = false;

        const records = entry.records;
        for (let i = records.length - 1; i >= 0; --i) {
            records[i].target.copyValue(records[i].before);
        }

        return entry;
    }

    /** Replays the entry ahead of the pointer and steps forward. */
    redo(): IJournalEntry
    {
        if (!this.canRedo) {
            return null;
        }

        const entry = this.entries[++this.pointer];
        entry.open = false;

        const records = entry.records;
        for (let i = 0, n = records.length; i < n; ++i) {
            records[i].target.copyValue(records[i].after);
        }

        return entry;
    }

    /** Accepts the current pointer position as the saved state. */
    markSaved()
    {
        this.commit();
        this.savedPointer = this.pointer;
        this.savedLost = false;
    }

    clear()
    {
        this.entries.length = 0;
        this.pointer = -1;
        this.savedPointer = -1;
        this.savedLost = false;
    }

    protected openEntry(time: number): IJournalEntry
    {
        if (this.pointer >= 0 && this.pointer === this.entries.length - 1) {
            const entry = this.entries[this.pointer];
            if (entry.open && time - entry.time <= EditJournal.coalesceWindow) {
                return entry;
            }
            entry.open = false;
        }

        // A new edit invalidates the redo tail. If the save point was in that
        // tail it can no longer be reached by undoing, so the document stays
        // dirty until it is saved again.
        if (this.entries.length > this.pointer + 1) {
            if (this.savedPointer > this.pointer) {
                this.savedLost = true;
            }
            this.entries.length = this.pointer + 1;
        }

        const entry: IJournalEntry = { records: [], time, open: true, name: "", title: "" };
        this.entries.push(entry);
        this.pointer = this.entries.length - 1;

        while (this.entries.length > this.capacity) {
            this.entries.shift();
            --this.pointer;
            if (--this.savedPointer < -1) {
                // The save point fell off the bottom of the stack; undoing can
                // no longer reach it.
                this.savedPointer = -1;
                this.savedLost = true;
            }
        }

        return this.entries[this.pointer];
    }
}
