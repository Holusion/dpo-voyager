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

import { Dictionary } from "@ff/core/types";
import Component from "@ff/graph/Component";
import Property from "@ff/graph/Property";
import { TPersistMode } from "@ff/graph/propertyTypes";

export { TPersistMode };

////////////////////////////////////////////////////////////////////////////////

/**
 * Serialized input values of a component, keyed by property key.
 * Enums are serialized as their name, arrays are copies.
 */
export type TPersistedValues = Dictionary<any>;

/**
 * Persistence modes for inherited properties, whose shared schema can't be changed
 * by a subclass. Declare as `static readonly persist = { visible: "capture" }`.
 */
export interface IPersistOverrides
{
    persist?: Dictionary<TPersistMode>;
}

export function getPersistMode(component: Component, property: Property): TPersistMode
{
    if (property.schema.event) {
        return "never";
    }

    const overrides = (component.constructor as IPersistOverrides).persist;
    return overrides?.[property.key] ?? property.schema.persist ?? "never";
}

export function getPersistedProperties(component: Component, mode: TPersistMode): Property[]
{
    return component.ins.properties.filter(property => getPersistMode(component, property) === mode);
}

export function serializeValue(property: Property, value: any = property.value)
{
    const enumeration = property.schema.enum;
    if (enumeration) {
        return enumeration[value] ?? enumeration[property.schema.preset];
    }

    return Array.isArray(value) ? value.slice() : value;
}

/**
 * Serializes all persisted inputs of a component.
 * @param values Values to use in place of the live ones, e.g. captured values.
 */
export function serializeInputs(component: Component, values?: Map<Property, any>): TPersistedValues
{
    const result: TPersistedValues = {};

    component.ins.properties.forEach(property => {
        if (getPersistMode(component, property) !== "never") {
            const value = values && values.has(property) ? values.get(property) : property.value;
            result[property.key] = serializeValue(property, value);
        }
    });

    return result;
}
