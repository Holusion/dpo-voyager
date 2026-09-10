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

import Property from "@ff/graph/Property";

import { IJournalNaming, IJournalTarget } from "./EditJournal";

////////////////////////////////////////////////////////////////////////////////

/** Longest string value spelled out in a title before it is cut short. */
const maxStringLength = 32;

/**
 * Names an edit the way the person who made it would: "Floor opacity",
 * "Sunlight intensity", "Mausoleum base color". The component supplies the
 * subject - for anything living on a node, that is the node's own name, so two
 * models in one scene do not read alike - and the property supplies the rest.
 */
export function labelOf(target: IJournalTarget): string
{
    const property = target as Property;
    const component = property.group && property.group.linkable as any;

    const subject = component && component.displayName || "";
    const rest = words(property.name || property.path);

    if (!subject) {
        return rest;
    }

    // "Grid" + "Visible" reads as "Grid visible"; a subject that already says
    // it - "Floor" + "Floor opacity" from a one-component group - does not need
    // saying twice.
    const lowered = rest.toLowerCase();
    if (lowered.startsWith(subject.toLowerCase())) {
        return rest;
    }

    return `${subject} ${lowered}`;
}

/**
 * One value of a property, in the terms its own editor uses: enums by their
 * option text, booleans as on and off, colours as hex, vectors bracketed.
 */
export function valueOf(target: IJournalTarget, value: any): string
{
    const property = target as Property;
    const schema = property.schema || {} as any;

    if (value === null || value === undefined) {
        return "none";
    }

    if (Array.isArray(value)) {
        if (schema.semantic === "color") {
            return hex(value);
        }
        return `[${value.map(v => scalar(v, schema)).join(", ")}]`;
    }

    return scalar(value, schema);
}

/** The naming CVSaveState hands the journal. */
export const propertyNaming: IJournalNaming = {
    label: labelOf,
    value: valueOf,
};

////////////////////////////////////////////////////////////////////////////////

function scalar(value: any, schema: any): string
{
    if (typeof value === "boolean") {
        return value ? "on" : "off";
    }

    if (typeof value === "number") {
        // An enum reads as its option text; the number behind it means nothing
        // to the person who picked "Left" from a dropdown.
        const options = schema.options;
        if (options) {
            const i = Math.trunc(value);
            const option = options[i < 0 || i >= options.length ? 0 : i];
            if (option) {
                return option;
            }
        }

        if (!isFinite(value)) {
            return String(value);
        }

        // Enough digits to tell two positions apart, without printing the
        // sixteen a float can carry.
        return String(Math.round(value * 1000) / 1000);
    }

    if (typeof value === "string") {
        const text = value.length > maxStringLength
            ? value.slice(0, maxStringLength - 1) + "…" : value;
        return text ? `"${text}"` : "empty";
    }

    return String(value);
}

function hex(rgb: number[]): string
{
    let out = "#";
    for (let i = 0; i < 3; ++i) {
        const byte = Math.max(0, Math.min(255, Math.round((rgb[i] || 0) * 255)));
        out += byte.toString(16).padStart(2, "0");
    }
    return out;
}

/** "BaseColor" -> "Base Color", "ViewPreset" -> "View Preset". */
function words(name: string): string
{
    return name
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}
