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

import GltfLoaderPlugin from "./GltfLoaderPlugin";

////////////////////////////////////////////////////////////////////////////////
//
// Default (single-bundle) model loader registry.
//
// Every loader is statically imported here, so webpack compiles all of them
// into the main bundle, as required by default. Selected via the
// "@loaders/model" alias in webpack.config.js unless VOYAGER_MODULAR_LOADERS
// is set, in which case registry.modular.ts is used instead.
//
// To add a new model format: create a plugin implementing IModelLoader (see
// GltfLoaderPlugin.ts), then add one entry below AND a matching one in
// registry.modular.ts. Nothing else needs to change.
//
////////////////////////////////////////////////////////////////////////////////

const modules: ILoaderModule<IModelLoader>[] = [
    { extensions: GltfLoaderPlugin.extensions, mimeTypes: GltfLoaderPlugin.mimeTypes, load: async () => GltfLoaderPlugin },
];

export default modules;
