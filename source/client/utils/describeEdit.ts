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
 * "Sunlight intensity", "Viewer annotations visible". Three parts, each
 * dropped when it says nothing: the component it belongs to, the group the
 * property sits in, and the property itself.
 */
export function labelOf(target: IJournalTarget): string
{
    const property = target as Property;
    const component = property.group && property.group.linkable as any;

    const subject = component ? subjectOf(component) : "";
    const parts = (property.path || "").split(".");
    const name = words(parts.pop() || property.path);

    // The group prefix carries real information when it names a facet of a
    // bigger component - Annotations.Visible on the viewer, Shadow.Blur on a
    // light - and none when it just repeats the component or is one of the
    // library's generic bases.
    let group = parts.length ? words(parts.join(" ")) : "";
    if (group && (isNoise(group) || related(subject, group))) {
        group = "";
    }

    const rest = [ group, name ].filter(part => !!part).join(" ").toLowerCase();

    if (!subject) {
        return sentence(rest);
    }

    if (related(subject, rest)) {
        return sentence(rest);
    }

    return `${subject} ${rest}`;
}

/**
 * What to call the thing the property belongs to. displayName is right for
 * anything the author has named - two models in a scene read differently - but
 * it falls back to the type name, and the library's own fallback drops a single
 * character, which leaves the V on Voyager's two-letter prefix. A document is
 * named after its file, which is not what changed either.
 */
function subjectOf(component: any): string
{
    const name = component.displayName;

    if (name && name !== component.displayTypeName && !isFileName(name)) {
        return name;
    }

    if (component.text) {
        return component.text;
    }

    const typeName = String(component.typeName || "");
    const bare = /^CV[A-Z]/.test(typeName) ? typeName.substr(2)
        : (/^C[A-Z]/.test(typeName) ? typeName.substr(1) : typeName);

    // "Model2" is a class generation, not something to show anyone.
    return words(bare.replace(/\d+$/, ""));
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

/** Group prefixes that come from a library base class and name nothing. */
function isNoise(group: string): boolean
{
    return group === "Object" || group === "Transform";
}

/** Whether one of these already says the other, so saying both is noise. */
function related(a: string, b: string): boolean
{
    if (!a || !b) {
        return false;
    }
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    return x.indexOf(y) >= 0 || y.indexOf(x) >= 0;
}

function isFileName(name: string): boolean
{
    return /\.[a-z0-9]{2,6}$/i.test(name);
}

function sentence(text: string): string
{
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** "BaseColor" -> "Base Color", "ViewPreset" -> "View Preset". */
function words(name: string): string
{
    return name
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}
