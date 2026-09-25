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
// Geometry loader registry.
//
// Every entry below is loaded through a dynamic import(). Whether that turns
// into a real on-demand network request or gets compiled straight into the
// current bundle (the default) is decided entirely by webpack's
// `module.parser.javascript.dynamicImportMode`, set in webpack.config.js from
// VOYAGER_MODULAR_LOADERS - this file is identical either way. Extensions are
// listed here rather than read off the loader class so a URL's validity can
// be checked without the loader's code having run yet.
//
// To add a new geometry format: create a plugin implementing IGeometryLoader
// (see ObjLoaderPlugin.ts) and add one entry below. Nothing else needs to change.
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
