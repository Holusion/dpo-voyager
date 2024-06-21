/**
 * 3D Foundation Project
 * Copyright 2024 Smithsonian Institution
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

//import resolvePathname from "resolve-pathname";
import UberPBRAdvMaterial from "client/shaders/UberPBRAdvMaterial";
import { LoadingManager, Object3D, Scene, Group, Mesh, MeshStandardMaterial, SRGBColorSpace, MeshPhysicalMaterial, WebGLRenderer } from "three";

import {DRACOLoader} from 'three/examples/jsm/loaders/DRACOLoader.js';
import {MeshoptDecoder} from "three/examples/jsm/libs/meshopt_decoder.module.js";
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

import UberPBRMaterial from "../shaders/UberPBRMaterial";
import CRenderer from "@ff/scene/components/CRenderer";

////////////////////////////////////////////////////////////////////////////////

const DEFAULT_DRACO_PATH = "https://www.gstatic.com/draco/versioned/decoders/1.5.6/";

export default class ModelReader
{
    static readonly extensions = [ "gltf", "glb" ];
    static readonly mimeTypes = [ "model/gltf+json", "model/gltf-binary" ];

    protected loadingManager: LoadingManager;
    protected renderer: CRenderer;
    protected gltfLoader :GLTFLoader;

    protected customDracoPath = null;

    private queue = Promise.resolve();

    set dracoPath(path: string) 
    {
        this.customDracoPath = path;
        if(this.gltfLoader.dracoLoader !== null) {
            this.gltfLoader.dracoLoader.setDecoderPath(this.customDracoPath);
        }
    }


    constructor(loadingManager: LoadingManager, renderer: CRenderer)
    {
        this.loadingManager = loadingManager;

        //const dracoPath = resolvePathname("js/draco/", window.location.origin + window.location.pathname);

        if (ENV_DEVELOPMENT) {
            console.log("ModelReader.constructor - DRACO path: %s", this.customDracoPath || DEFAULT_DRACO_PATH);
        }

        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath(this.customDracoPath || DEFAULT_DRACO_PATH);
        this.renderer = renderer;
        this.gltfLoader = new GLTFLoader(loadingManager);
        this.gltfLoader.setDRACOLoader(dracoLoader);
        this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);
    }

    dispose()
    {
        this.gltfLoader.dracoLoader.dispose();
        this.gltfLoader.setDRACOLoader(null);
        this.gltfLoader = null;
    }

    isValid(url: string): boolean
    {
        const extension = url.split(".").pop().toLowerCase();
        return ModelReader.extensions.indexOf(extension) >= 0;
    }

    isValidMimeType(mimeType: string): boolean
    {
        return ModelReader.mimeTypes.indexOf(mimeType) >= 0;
    }

    get(url: string): Promise<Object3D>
    {
        console.debug("Load model :", url)
        return new Promise((resolve, reject) => {
            /** ktx2Loader has been here for a long time but only added to types definitions in r165 */
            if(!(this.gltfLoader as any).ktx2Loader){
                const ktx2Loader = new KTX2Loader(this.loadingManager);
                ktx2Loader.setTranscoderPath("/dist/js/basis/");
                ktx2Loader.detectSupport(this.renderer.views[0].renderer);
                this.gltfLoader.setKTX2Loader(ktx2Loader);
            }

            this.gltfLoader.load(url, gltf => {
                resolve(this.createModelGroup(gltf));
            }, null, error => {
                if(this.gltfLoader === null || this.gltfLoader.dracoLoader === null) {
                    // HACK to avoid errors when component is removed while loading still in progress.
                    // Remove once Three.js supports aborting requests again.
                    resolve(null);
                }
                else {
                    console.error(`failed to load '${url}': ${error}`);
                    reject(new Error(error as any));
                }
            })
        });
    }

    protected async createModelGroup(gltf): Promise<Object3D>
    {
        const group: Scene = gltf.scene;
        let textures = [];
        await new Promise((resolve=>{
                requestAnimationFrame(resolve);
            }));
        group.traverse((object: any) => {
            if (object.type === "Mesh") {
                const mesh: Mesh = object;
                mesh.castShadow = true;
                const material = mesh.material as MeshStandardMaterial;

                if (material.map) {
                   material.map.colorSpace = SRGBColorSpace;
                }

                mesh.geometry.computeBoundingBox();

                const uberMat = material.type === "MeshPhysicalMaterial" ? new UberPBRAdvMaterial() : new UberPBRMaterial();
                
                if (material.flatShading) {
                    mesh.geometry.computeVertexNormals();
                    material.flatShading = false;
                    console.warn("Normals unavailable so they have been calculated. For best outcomes, please provide normals with geometry.");
                }

                // copy properties from previous material
                if (material.type === "MeshPhysicalMaterial" || material.type === "MeshStandardMaterial") {
                    uberMat.copy(material);
                }

                // check if the material's normal map uses object space (indicated in glTF extras)
                if (material.userData["objectSpaceNormals"]) {
                    uberMat.enableObjectSpaceNormalMap(true);

                    if (ENV_DEVELOPMENT) {
                        console.log("ModelReader.createModelGroup - objectSpaceNormals: ", true);
                    }
                }
                textures.push(uberMat.alphaMap, uberMat.aoMap, uberMat.bumpMap, uberMat.displacementMap, uberMat.emissiveMap, uberMat.envMap, uberMat.lightMap, uberMat.map, uberMat.metalnessMap, uberMat.normalMap, uberMat.roughnessMap, uberMat.zoneMap);

                mesh.material = uberMat;
            }
        });
        const webRenderer= this.renderer?.views[0]?.renderer;
        const camera = this.renderer.activeCamera;
        const s = this.renderer.activeScene;
        for(let tex of textures){
            if(!tex) continue;
            this.queue = this.queue.then(()=>new Promise((resolve=>{
                requestAnimationFrame(()=>{
                    console.debug("Load texture", Date.now());
                    webRenderer.initTexture(tex);
                    resolve();
                });
            })));
        }
        await this.queue;
        console.debug("Compile");
        //compileAsync requires THREE r161
        //await webRenderer.compileAsync(s, camera, group);
        return group;
    }
}