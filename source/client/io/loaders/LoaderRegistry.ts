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

import { ILoaderContext, ILoaderModule } from "./types";

////////////////////////////////////////////////////////////////////////////////

/**
 * Resolves file extensions to loader plugin instances.
 *
 * Instantiation is lazy and cached per extension: the first file of a given
 * type triggers `module.load()` (a no-op in the default bundle, a dynamic
 * `import()` in the modular one) and construction of the plugin; every
 * subsequent file of that type reuses the same instance. Concurrent requests
 * for the same, not-yet-resolved extension share a single in-flight promise.
 */
export default class LoaderRegistry<TLoader>
{
    private readonly instances = new Map<string, TLoader>();
    private readonly pending = new Map<string, Promise<TLoader>>();

    constructor(
        private readonly modules: ILoaderModule<TLoader>[],
        private readonly context: ILoaderContext,
    ) {}

    static extensionOf(url: string): string
    {
        return url.split(".").pop().toLowerCase();
    }

    get extensions(): string[]
    {
        return this.modules.flatMap(module => module.extensions);
    }

    isValid(url: string): boolean
    {
        const extension = LoaderRegistry.extensionOf(url);
        return this.modules.some(module => module.extensions.includes(extension));
    }

    isValidMimeType(mimeType: string): boolean
    {
        return this.modules.some(module => module.mimeTypes?.includes(mimeType));
    }

    /** Instances created so far, e.g. to reconfigure or dispose of them. */
    get loaded(): TLoader[]
    {
        return Array.from(this.instances.values());
    }

    resolve(url: string): Promise<TLoader>
    {
        const extension = LoaderRegistry.extensionOf(url);

        const instance = this.instances.get(extension);
        if (instance) {
            return Promise.resolve(instance);
        }

        const inflight = this.pending.get(extension);
        if (inflight) {
            return inflight;
        }

        const module = this.modules.find(m => m.extensions.includes(extension));
        if (!module) {
            return Promise.reject(new Error(`can't load, no loader registered for extension: '${extension}'`));
        }

        const promise = module.load().then(LoaderCtor => {
            const instance = new LoaderCtor(this.context);
            this.instances.set(extension, instance);
            this.pending.delete(extension);
            return instance;
        });

        this.pending.set(extension, promise);
        return promise;
    }
}
