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

import { LoadingManager, Object3D, AnimationClip, BufferGeometry } from "three";
import CRenderer from "@ff/scene/components/CRenderer";

////////////////////////////////////////////////////////////////////////////////

/** Shared construction context passed to every loader. */
export interface ILoaderContext
{
    loadingManager: LoadingManager;
    /** Only populated for model loaders that need access to the active renderer (e.g. for KTX2 transcoder feature detection). */
    renderer?: CRenderer;
}

/**
 * Describes one loader implementation without requiring its code to be
 * imported up front: `extensions` (and `mimeTypes`, for model loaders) are
 * listed statically here so a file can be routed to the right loader before
 * that loader's module has been fetched.
 *
 * `load()` resolves to the loader's class via a dynamic `import()`. Whether
 * that turns into a real on-demand chunk or gets resolved straight into the
 * current bundle depends on webpack's `dynamicImportMode` (see webpack.config.js).
 */
export interface ILoaderModule<TLoader>
{
    extensions: string[];
    mimeTypes?: string[];
    load(): Promise<{ new(context: ILoaderContext): TLoader }>;
}

/** A loader able to parse geometry-only formats (e.g. OBJ, PLY). */
export interface IGeometryLoader
{
    load(url: string): Promise<BufferGeometry>;
}

/** Common result shape every model loader must produce, regardless of source format. */
export interface IModelLoaderResult
{
    scene: Object3D;
    animations?: AnimationClip[];
}

/** A loader able to parse full scene/model formats (e.g. glTF/GLB). */
export interface IModelLoader
{
    load(url: string, options?: { signal?: AbortSignal }): Promise<IModelLoaderResult>;
    /** Optional: receives asset/decoder path configuration, applied on construction and whenever it changes afterwards. */
    configure?(config: { dracoPath?: string, assetPath?: string }): void;
    dispose?(): void;
}
