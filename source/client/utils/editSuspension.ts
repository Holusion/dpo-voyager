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

import System from "@ff/graph/System";
import Component from "@ff/graph/Component";

////////////////////////////////////////////////////////////////////////////////

/** The part of CVSaveState a producer of derived writes needs. */
export interface IEditSuspender
{
    suspend(): void;
    resume(): void;
}

/** The part of CVSaveState something that edits non-property state needs. */
export interface IEditReporter
{
    markUnjournaledEdit(): void;
    resyncBaseline(component: Component): void;
}

/**
 * Runs a block whose property writes are derived rather than authored, so the
 * edit journal does not record them - recomputing the floor from the scene
 * bounds is not something the user did, even though it writes properties a save
 * would record.
 *
 * The component is found by name: it exists only in the story tool, and looking
 * it up this way keeps components shared with the explorer free of a dependency
 * on it. Outside the story tool the block simply runs.
 */
export function withoutEdits(system: System, fn: () => void)
{
    const suspender = system.components.get("CVSaveState", true) as any as IEditSuspender;

    if (!suspender) {
        return fn();
    }

    suspender.suspend();
    try {
        fn();
    }
    finally {
        suspender.resume();
    }
}

/**
 * Reports an edit to something the change observer cannot see, because it does
 * not live in a graph property: an annotation's title, body or position, held
 * on the annotation object itself.
 *
 * The document goes unsaved, but the journal has no baseline for it, so undo
 * cannot take it back and only saving clears it. That is the conservative half
 * of the trade until phase 2 records structural change properly - the point is
 * that editing an annotation must not leave the tool claiming there is nothing
 * to save.
 *
 * Found by name and a no-op outside the story tool, like [[withoutEdits]], and
 * ignored inside a withoutEdits() bracket - a model dragging its annotations
 * along is not the user editing them.
 */
export function markUnjournaledEdit(system: System)
{
    const reporter = system.components.get("CVSaveState", true) as any as IEditReporter;

    reporter && reporter.markUnjournaledEdit();
}

/**
 * Says that a component's property values have been replaced behind the edit
 * journal's back - a panel loading its fields for a newly selected item, which
 * it does silently so that loading them is not itself an edit.
 *
 * A silent write moves the value without setting a changed flag, so the journal
 * never sees it and keeps the previous item's value as the baseline. Editing
 * the field afterwards would be recorded against that, and undo would write the
 * previous item's value into the current one. This re-takes the baseline.
 *
 * Found by name and a no-op outside the story tool, like [[withoutEdits]].
 */
export function resyncEditBaseline(system: System, component: Component)
{
    const reporter = system.components.get("CVSaveState", true) as any as IEditReporter;

    reporter && reporter.resyncBaseline(component);
}
