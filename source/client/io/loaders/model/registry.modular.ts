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

import { IModelLoader, ILoaderModule } from "../types";

////////////////////////////////////////////////////////////////////////////////
//
// Modular model loader registry.
//
// Each loader is fetched with a dynamic import() only when a file of its
// type is actually requested, so webpack splits it into its own chunk (named
// via webpackChunkName below). Extensions/mimeTypes are listed here rather
// than read off the loader class, so a URL's validity can be checked without
// downloading that loader's code (and, for glTF, its DRACO/KTX2/meshopt
// dependencies).
//
// To add a new model format: create a plugin implementing IModelLoader (see
// GltfLoaderPlugin.ts), then add one entry below AND a matching one in
// registry.bundle.ts. Nothing else needs to change.
//
////////////////////////////////////////////////////////////////////////////////

const modules: ILoaderModule<IModelLoader>[] = [
    {
        extensions: [ "gltf", "glb" ],
        mimeTypes: [ "model/gltf+json", "model/gltf-binary" ],
        load: () => import(/* webpackChunkName: "loader-gltf" */ "./GltfLoaderPlugin").then(m => m.default),
    },
];

export default modules;
