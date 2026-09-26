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

import { LoadingManager, MeshStandardMaterial, SRGBColorSpace, LoaderUtils } from "three";

import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

import CRenderer from "@ff/scene/components/CRenderer";
import { DEFAULT_SYSTEM_ASSET_PATH } from "client/components/CVAssetReader";

import { IModelLoader, IModelLoaderResult, ILoaderContext } from "../types";
import LoadQueue from "../utils/LoadQueue";

////////////////////////////////////////////////////////////////////////////////

export default class GltfLoader implements IModelLoader
{
    static readonly extensions = [ "gltf", "glb" ];
    static readonly mimeTypes = [ "model/gltf+json", "model/gltf-binary" ];

    private loadingManager: LoadingManager;
    private renderer: CRenderer;
    private gltfLoader: GLTFLoader;
    private dracoLoader: DRACOLoader;
    private ktx2Loader: KTX2Loader;

    private loadQueue = new LoadQueue();

    private customDracoPath: string = null;

    constructor({ loadingManager, renderer }: ILoaderContext)
    {
        this.loadingManager = loadingManager;
        this.renderer = renderer;

        this.dracoLoader = new DRACOLoader();
        this.dracoLoader.setDecoderPath(DEFAULT_SYSTEM_ASSET_PATH + "js/draco/");

        this.gltfLoader = new GLTFLoader(loadingManager);
        this.gltfLoader.setDRACOLoader(this.dracoLoader);
        this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);

        this.ktx2Loader = new KTX2Loader(loadingManager);
        this.ktx2Loader.setTranscoderPath(DEFAULT_SYSTEM_ASSET_PATH + "js/basis/");
        this.gltfLoader.setKTX2Loader(this.ktx2Loader);

        setTimeout(() => {
            // Allow an update to happen. @todo check how robust it is
            this.ktx2Loader.detectSupport(this.renderer.views[0].renderer);
        }, 0);
    }

    configure({ dracoPath, assetPath }: { dracoPath?: string, assetPath?: string })
    {
        if (dracoPath) {
            this.customDracoPath = dracoPath;
            this.dracoLoader.setDecoderPath(dracoPath);
        }

        if (assetPath) {
            // `assetPath` is expected to already be normalized (no trailing slash) by the caller.
            if (!this.customDracoPath) {
                this.dracoLoader.setDecoderPath(`${assetPath}/js/draco/`);
            }
            this.ktx2Loader.setTranscoderPath(`${assetPath}/js/basis/`);
        }
    }

    dispose()
    {
        this.dracoLoader.dispose();
        this.ktx2Loader.dispose();
        this.gltfLoader.setDRACOLoader(null);
        this.gltfLoader.setKTX2Loader(null);
        this.gltfLoader = null;
    }

    async load(url: string, { signal }: { signal?: AbortSignal } = {}): Promise<IModelLoaderResult>
    {
        const resourcePath = LoaderUtils.extractUrlBase(url);

        const data = await this.loadQueue.fetch(url, { signal });
        const gltf = await this.gltfLoader.parseAsync(data, resourcePath);

        // Check for Kintsugi materials and extract them automatically from the glTF
        gltf.scene.traverse(object => {
            const material = object["material"] as MeshStandardMaterial;

            if (material) {
                // Use Kintsugi diffuse instead of the albedo map (which incorporates both diffuse and specular)
                const kintsugiDiffuse = material.userData["diffuseTexture"];
                if (kintsugiDiffuse) {
                    gltf.parser.loadTexture(kintsugiDiffuse.index)
                    .then(texture => {
                        texture.colorSpace = SRGBColorSpace;
                        material.map = texture;
                        material.needsUpdate = true;
                    });
                }

                // Kintsugi specular is loaded as a custom texture map
                const kintsugiSpecular = material.userData["specularTexture"];
                if (kintsugiSpecular) {
                    gltf.parser.loadTexture(kintsugiSpecular.index)
                    .then(texture => {
                        texture.colorSpace = SRGBColorSpace;
                        material.metalness = 0.0;
                        material.roughness = 1.0;
                        material.userData.shader.uniforms["specularOverrideMap"].value = texture;
                        material.defines["USE_KINTSUGI"] = true;
                        material.needsUpdate = true;
                    });
                }
            }
        });

        if (gltf.userData.gltfExtensions) {
            const variantsExtension = gltf.userData.gltfExtensions['KHR_materials_variants'];
            if (variantsExtension) {
                const parser = gltf.parser;
                gltf.scene.userData["variants"] = variantsExtension.variants;
                gltf.scene.userData["variants"].variantMaterials = {};
                gltf.scene.userData["parser"] = parser;
            }
        }

        return { scene: gltf.scene, animations: gltf.animations };
    }
}
