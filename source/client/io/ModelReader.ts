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

import { LoadingManager, Object3D, Mesh, MeshStandardMaterial, SRGBColorSpace, ObjectSpaceNormalMap } from "three";

import CRenderer from "@ff/scene/components/CRenderer";
import { disposeObject } from "@ff/three/helpers";
import { addCustomMaterialDefines, extendShaders } from "client/shaders/ShaderExtension";

import modelLoaderModules from "./loaders/model/registry";
import LoaderRegistry from "./loaders/LoaderRegistry";
import { IModelLoader, IModelLoaderResult } from "./loaders/types";

////////////////////////////////////////////////////////////////////////////////

export default class ModelReader
{
    // Kept as statics for compatibility with code that checks supported
    // extensions/mime types before constructing a reader.
    static get extensions(): string[]
    {
        return modelLoaderModules.flatMap(module => module.extensions);
    }
    static get mimeTypes(): string[]
    {
        return modelLoaderModules.flatMap(module => module.mimeTypes || []);
    }

    protected loadingManager: LoadingManager;
    protected renderer: CRenderer;
    protected registry: LoaderRegistry<IModelLoader>;

    protected pendingConfig: { dracoPath?: string, assetPath?: string } = {};

    constructor(loadingManager: LoadingManager, renderer: CRenderer)
    {
        this.loadingManager = loadingManager;
        this.renderer = renderer;
        this.registry = new LoaderRegistry(modelLoaderModules, { loadingManager, renderer });
    }

    set dracoPath(path: string)
    {
        this.configure({ dracoPath: path });
    }

    setAssetPath(path: string)
    {
        path = path.endsWith("/") ? path.slice(0, -1) : path;
        this.configure({ assetPath: path });
    }

    private configure(config: { dracoPath?: string, assetPath?: string })
    {
        this.pendingConfig = { ...this.pendingConfig, ...config };
        // Loaders instantiated before this call get reconfigured immediately;
        // loaders instantiated afterwards pick up `pendingConfig` in get().
        this.registry.loaded.forEach(loader => loader.configure?.(this.pendingConfig));
    }

    dispose()
    {
        this.registry.loaded.forEach(loader => loader.dispose?.());
    }

    isValid(url: string): boolean
    {
        return this.registry.isValid(url);
    }

    isValidMimeType(mimeType: string): boolean
    {
        return this.registry.isValidMimeType(mimeType);
    }

    get(url: string, { signal }: { signal?: AbortSignal } = {}): Promise<Object3D>
    {
        this.loadingManager.itemStart(url);

        return this.registry.resolve(url)
        .then(loader => {
            loader.configure?.(this.pendingConfig);
            return loader.load(url, { signal });
        })
        .then(result => this.createModelGroup(result, { signal }))
        .catch((e) => {
            this.loadingManager.itemError(url);
            throw e;
        }).finally(() => this.loadingManager.itemEnd(url));
    }

    protected async createModelGroup(result: IModelLoaderResult, { signal }: { signal?: AbortSignal } = {}): Promise<Object3D>
    {
        if (signal.aborted) throw new DOMException(signal.reason, "AbortError");
        const scene = result.scene;
        const animations = result.animations || [];

        scene.traverse((object: any) => {
            if (object.type === "Mesh") {
                const mesh: Mesh = object;
                mesh.castShadow = true;
                animations.forEach((anim) => {
                    if(anim.tracks[0].name.split(".")[0] === mesh.name) {
                        mesh.animations.push(anim);
                    }
                    // handle grouped meshes split by material at import
                    else if(anim.tracks[0].name.split(".")[0] === mesh.parent.name) {
                        if(!mesh.parent.animations.includes(anim)) {
                            mesh.parent.animations.push(anim);
                        }
                    }
                });

                // convert unlit glTFs to MeshStandardMaterial
                if((mesh.material as MeshStandardMaterial).type === "MeshBasicMaterial") {
                    const oldMaterial = mesh.material as MeshStandardMaterial;
                    const newMaterial = new MeshStandardMaterial();
                    newMaterial.color = oldMaterial.color;
                    newMaterial.opacity = oldMaterial.opacity;
                    newMaterial.transparent = oldMaterial.opacity < 1 || !!oldMaterial.alphaMap;
                    newMaterial.map = oldMaterial.map;
                    newMaterial.shadowSide = oldMaterial.shadowSide;

                    mesh.material = newMaterial;
                }

                const material =  mesh.material as MeshStandardMaterial;

                if (material.map) {
                   material.map.colorSpace = SRGBColorSpace;
                }

                mesh.geometry.computeBoundingBox();

                // update default shaders for extended functionality
                extendShaders(material);
                material.userData.paramCopy = {};

                // add defines for shader customization
                addCustomMaterialDefines(material);

                if (material.flatShading) {
                    mesh.geometry.computeVertexNormals();
                    material.flatShading = false;
                    console.warn("Normals unavailable so they have been calculated. For best outcomes, please provide normals with geometry.");
                }

                // check if the material's normal map uses object space (indicated in glTF extras)
                if (material.userData["objectSpaceNormals"]) {
                    if (material.normalMap) {
                        material.normalMapType = ObjectSpaceNormalMap;
                        material.needsUpdate = true;
                    }

                    if (ENV_DEVELOPMENT) {
                        console.log("ModelReader.createModelGroup - objectSpaceNormals: ", true);
                    }
                }
            }
        });

        try {
            await this.renderer.views[0].renderer.compileAsync(scene, this.renderer.activeCamera, this.renderer.activeScene);
            if(signal.aborted) throw new DOMException(signal.reason, "AbortError");
        }
        catch(e) {
            try {
                disposeObject(scene);
            }
            catch(e) {
                console.warn("Failed to dispose of cancelled glTF scene", e);
            }
            throw e;
        }
        return scene;
    }
}
