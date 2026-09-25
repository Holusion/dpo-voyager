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

import { LoadingManager, BufferGeometry } from "three";

import geometryLoaderModules from "./loaders/geometry/registry";
import LoaderRegistry from "./loaders/LoaderRegistry";
import { IGeometryLoader } from "./loaders/types";

////////////////////////////////////////////////////////////////////////////////

export default class GeometryReader
{
    // Kept as a static for compatibility with code that checks supported
    // extensions before constructing a reader.
    static get extensions(): string[]
    {
        return geometryLoaderModules.flatMap(module => module.extensions);
    }

    private registry: LoaderRegistry<IGeometryLoader>;

    constructor(loadingManager: LoadingManager)
    {
        this.registry = new LoaderRegistry(geometryLoaderModules, { loadingManager });
    }

    isValid(url: string): boolean
    {
        return this.registry.isValid(url);
    }

    async get(url: string): Promise<BufferGeometry>
    {
        const loader = await this.registry.resolve(url);
        return loader.load(url);
    }
}
