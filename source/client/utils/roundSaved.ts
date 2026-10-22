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

/** Rounds a number as documents are saved: 7 decimals. */
export default function roundSaved(value: number): number
{
    return parseFloat(value.toFixed(7));
}

/**
 * Whether two property values are saved the same: numbers recomputed at runtime, or a tween ending on
 * `a + 1 * (b - a)` rather than exactly `b`, aren't different.
 */
export function equalOnceSaved(a: any, b: any): boolean
{
    if (typeof a === "number" && typeof b === "number") {
        return roundSaved(a) === roundSaved(b);
    }
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((v, i) => equalOnceSaved(v, b[i]));
    }
    if (a instanceof Date || b instanceof Date) {
        return new Date(a).getTime() === new Date(b).getTime();
    }
    return a === b;
}
