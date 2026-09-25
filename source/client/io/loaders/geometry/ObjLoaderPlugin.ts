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

import { BufferGeometry } from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

import { IGeometryLoader, ILoaderContext } from "../types";

////////////////////////////////////////////////////////////////////////////////

export default class ObjLoaderPlugin implements IGeometryLoader
{
    static readonly extensions = [ "obj" ];

    private loader: OBJLoader;

    constructor({ loadingManager }: ILoaderContext)
    {
        this.loader = new OBJLoader(loadingManager);
    }

    load(url: string): Promise<BufferGeometry>
    {
        return new Promise((resolve, reject) => {
            this.loader.load(url, result => {
                const geometry = (result.children[0] as any).geometry;
                if (geometry && geometry.type === "Geometry" || geometry.type === "BufferGeometry") {
                    return resolve(geometry);
                }

                return reject(new Error(`Can't parse geometry from '${url}'`));
            });
        });
    }
}
