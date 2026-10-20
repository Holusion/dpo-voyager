/**
 * 3D Foundation Project
 * Copyright 2026 Smithsonian Institution
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

/**
 * Pure helpers resolving tour steps made of sparse ("delta") states.
 *
 * A tour step no longer owns a full scene snapshot. Instead, each step is linked to zero or more
 * state change actions, each holding a sparse set of property values. The scene shown at step N is
 * the base scene state, overlaid with the states of steps 0..N in order ("hold" keyframes).
 * This makes a step's appearance independent of how it was reached (next, previous, jump).
 *
 * Paths are opaque keys (in practice "componentId/propertyKey").
 */

/** A sparse set of property values, keyed by path. */
export type ValueMap = Map<string, any>;

/** Values aligned with paths, as stored in a delta state. */
export interface IPathValues
{
    paths: string[];
    values: any[];
}

export function valuesEqual(a: any, b: any): boolean
{
    if (a === b) {
        return true;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((v, i) => valuesEqual(v, b[i]));
    }
    if (a instanceof Date || b instanceof Date) {
        return new Date(a).getTime() === new Date(b).getTime();
    }
    return false;
}

/** Overlays a state's values on `target`. Null values are placeholders and are skipped. */
export function applyState(target: ValueMap, state: IPathValues): ValueMap
{
    state.paths.forEach((path, index) => {
        const value = state.values[index];
        if (value !== null && value !== undefined) {
            target.set(path, value);
        }
    });
    return target;
}

/**
 * Returns the values the scene should hold at step `index`:
 * `base` overlaid with every state of steps 0..index, in order.
 * Within a step, later states win.
 */
export function composeStep(base: ValueMap, steps: IPathValues[][], index: number): ValueMap
{
    const result = new Map(base);
    for (let i = 0; i <= index && i < steps.length; ++i) {
        steps[i].forEach(state => applyState(result, state));
    }
    return result;
}

/** Union of all paths touched by the given steps. */
export function touchedPaths(steps: IPathValues[][]): Set<string>
{
    const paths = new Set<string>();
    steps.forEach(states => states.forEach(state => state.paths.forEach(path => paths.add(path))));
    return paths;
}

/**
 * Returns the entries of `current` that differ from `reference`.
 * Paths listed in `always` are included even when unchanged.
 */
export function diffValues(reference: ValueMap, current: ValueMap, always: Iterable<string> = []): IPathValues
{
    const forced = new Set(always);
    const result: IPathValues = { paths: [], values: [] };
    current.forEach((value, path) => {
        if (forced.has(path) || !reference.has(path) || !valuesEqual(reference.get(path), value)) {
            result.paths.push(path);
            result.values.push(value);
        }
    });
    return result;
}

/**
 * Converts absolute step snapshots (legacy tours) into sparse states that compose to the same values.
 * The first step stays complete: it defines the scene independently of the pre-tour state.
 * Later steps only keep values differing from the previous composed step, plus `always` paths.
 * A null entry is a step without a snapshot; it stays empty (holding the previous step).
 */
export function sparsifySteps(steps: IPathValues[], always: Iterable<string> = []): IPathValues[]
{
    const forced = Array.from(always);
    const composed: ValueMap = new Map();
    let first = true;

    return steps.map(step => {
        if (!step) {
            return null;
        }
        const values = applyState(new Map(), step);
        const result = first ? diffValues(new Map(), values) :
            diffValues(composed, values, forced.filter(path => values.has(path)));
        applyState(composed, step);
        first = false;
        return result;
    });
}
