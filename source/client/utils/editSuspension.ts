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

////////////////////////////////////////////////////////////////////////////////

/** The part of CVSaveState a producer of derived writes needs. */
export interface IEditSuspender
{
    suspend(): void;
    resume(): void;
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
