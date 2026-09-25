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

import { IGeometryLoader, ILoaderModule } from "../types";

////////////////////////////////////////////////////////////////////////////////
//
// Modular geometry loader registry.
//
// Each loader is fetched with a dynamic import() only when a file of its
// type is actually requested, so webpack splits it into its own chunk (named
// via webpackChunkName below). Extensions are listed here rather than read
// off the loader class, so a URL's validity can be checked without
// downloading that loader's code.
//
// To add a new geometry format: create a plugin implementing IGeometryLoader
// (see ObjLoaderPlugin.ts), then add one entry below AND a matching one in
// registry.bundle.ts. Nothing else needs to change.
//
////////////////////////////////////////////////////////////////////////////////

const modules: ILoaderModule<IGeometryLoader>[] = [
    {
        extensions: [ "obj" ],
        load: () => import(/* webpackChunkName: "loader-obj" */ "./ObjLoaderPlugin").then(m => m.default),
    },
    {
        extensions: [ "ply" ],
        load: () => import(/* webpackChunkName: "loader-ply" */ "./PlyLoaderPlugin").then(m => m.default),
    },
];

export default modules;
