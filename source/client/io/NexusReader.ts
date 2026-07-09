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

import { LoadingManager, Object3D } from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

import CRenderer from "@ff/scene/components/CRenderer";
import CScene, { ISceneAfterRenderEvent, ISceneBeforeRenderEvent } from "@ff/scene/components/CScene";
import { IActiveSceneEvent } from "@ff/scene/components/CRenderer";

import { INexus, loadNexus, setNexusScriptPath } from "./nexus/loadNexus";
import NexusObject from "./nexus/NexusObject";

////////////////////////////////////////////////////////////////////////////////

/**
 * Loads Nexus multiresolution meshes (.nxz / .nxs) and drives their streaming
 * refinement. Mirrors the role of {@link ModelReader} for glTF, but a Nexus
 * object is not a one-shot load: it must be updated every frame against the
 * camera, which requires
 *  - bracketing each render with `Nexus.beginFrame` / `Nexus.endFrame`, and
 *  - keeping Voyager's on-demand render loop awake while patches stream in
 *    (via {@link CRenderer.forceRender}).
 */
export default class NexusReader
{
    static readonly extensions = [ "nxz", "nxs" ];
    static readonly mimeTypes = [ "application/octet-stream" ];

    protected loadingManager: LoadingManager;
    protected renderer: CRenderer;

    /** Nexus objects currently live in the scene, driven every frame. */
    protected objects = new Set<NexusObject>();
    /** Scene we are currently subscribed to for per-frame begin/end frame hooks. */
    protected subscribedScene: CScene = null;
    protected nexus: INexus = null;
    /** Optional KTX2 loader, used to transcode KTX2-compressed Nexus node textures. */
    protected ktx2Loader: KTX2Loader = null;
    /** Whether `detectSupport` has been run on {@link ktx2Loader} (required before `parse`). */
    protected ktx2Ready = false;

    constructor(loadingManager: LoadingManager, renderer: CRenderer)
    {
        this.loadingManager = loadingManager;
        this.renderer = renderer;

        this.onBeforeRender = this.onBeforeRender.bind(this);
        this.onAfterRender = this.onAfterRender.bind(this);
        this.onActiveScene = this.onActiveScene.bind(this);
    }

    dispose()
    {
        this.objects.forEach(object => object.dispose());
        this.objects.clear();
        this.unsubscribe();
        this.renderer.off<IActiveSceneEvent>("active-scene", this.onActiveScene, this);
    }

    setNexusPath(path: string)
    {
        path = path.endsWith("/") ? path.slice(0, -1) : path;
        setNexusScriptPath(`${path}/js/nexus/nexus.js`);
    }

    /**
     * Supply a configured KTX2 (Basis) loader so Nexus meshes carrying
     * KTX2-compressed node textures can be transcoded. Typically the same
     * loader the glTF model reader uses (see CVAssetReader), avoiding a second
     * transcoder worker pool. The loader must already have its transcoder path
     * set and `detectSupport(renderer)` called.
     */
    setKTX2Loader(loader: KTX2Loader)
    {
        this.ktx2Loader = loader;
    }

    isValid(url: string): boolean
    {
        const extension = url.split(".").pop().toLowerCase();
        return NexusReader.extensions.indexOf(extension) >= 0;
    }

    isValidMimeType(mimeType: string): boolean
    {
        return NexusReader.mimeTypes.indexOf(mimeType) >= 0;
    }

    /** Whether the `lodHeatmap` URL query parameter is present (case-insensitive). */
    protected get heatmapEnabled(): boolean
    {
        if (typeof window === "undefined") {
            return false;
        }
        const params = new URLSearchParams(window.location.search);
        for (const key of params.keys()) {
            if (key.toLowerCase() === "lodheatmap") {
                return true;
            }
        }
        return false;
    }

    async get(url: string, { signal }: { signal?: AbortSignal } = {}): Promise<Object3D>
    {
        this.loadingManager.itemStart(url);

        try {
            const nexus = this.nexus = await loadNexus();
            if (signal?.aborted) {
                throw new DOMException(signal.reason, "AbortError");
            }

            const webglRenderer = this.renderer.views[0].renderer;

            // KTX2Loader.parse() throws unless detectSupport() has run, and the
            // loader is shared with ModelReader, which only calls it from a
            // deferred setTimeout in its constructor. For a Nexus-only scene that
            // timer may not have fired yet, so ensure readiness here (idempotent;
            // the renderer is guaranteed live by the time a model loads). Without
            // this, KTX2 node textures fail to transcode.
            if (this.ktx2Loader && !this.ktx2Ready) {
                this.ktx2Loader.detectSupport(webglRenderer);
                this.ktx2Ready = true;
            }

            // LOD heatmap: opt-in via `?lodHeatmap` (or `?lodHeatmap=1`) on the URL.
            // Tints each streamed node red (coarse) -> green (fine). Debug.nodes is a
            // global Nexus flag, so it applies to every Nexus object once enabled.
            const heatmap = this.heatmapEnabled;
            if (heatmap) {
                nexus.Debug.nodes = true;
            }

            return await new Promise<Object3D>((resolve, reject) => {
                const object = new NexusObject(nexus, url, webglRenderer, {
                    onLoad: () => resolve(object),
                    // Streaming refinement: keep the render loop alive so the next
                    // frame can request/draw finer patches against the camera.
                    onUpdate: () => this.renderer.forceRender(),
                    heatmap,
                    ktx2Loader: this.ktx2Loader,
                });

                this.register(object);

                if (signal) {
                    signal.addEventListener("abort", () => {
                        this.release(object);
                        reject(new DOMException(signal.reason, "AbortError"));
                    }, { once: true });
                }
            });
        }
        catch (e) {
            this.loadingManager.itemError(url);
            throw e;
        }
        finally {
            this.loadingManager.itemEnd(url);
        }
    }

    ////////////////////////////////////////////////////////////////////////////////
    // Per-frame driving

    protected register(object: NexusObject)
    {
        this.objects.add(object);

        // Voyager disposes a model's geometry through disposeObject() on unload;
        // that fires the geometry "dispose" event. Use it to release the Nexus
        // instance and stop driving this object.
        const onDispose = () => {
            object.geometry.removeEventListener("dispose", onDispose);
            this.release(object);
        };
        object.geometry.addEventListener("dispose", onDispose);

        if (this.objects.size === 1) {
            this.subscribe();
            this.renderer.on<IActiveSceneEvent>("active-scene", this.onActiveScene, this);
        }
        this.renderer.forceRender();
    }

    protected release(object: NexusObject)
    {
        if (!this.objects.has(object)) {
            return;
        }
        this.objects.delete(object);
        object.releaseInstance();

        if (this.objects.size === 0) {
            this.unsubscribe();
            this.renderer.off<IActiveSceneEvent>("active-scene", this.onActiveScene, this);
        }
    }

    protected subscribe()
    {
        const scene = this.renderer.activeSceneComponent;
        if (scene === this.subscribedScene) {
            return;
        }
        this.unsubscribe();
        if (scene) {
            scene.on<ISceneBeforeRenderEvent>("before-render", this.onBeforeRender, this);
            scene.on<ISceneAfterRenderEvent>("after-render", this.onAfterRender, this);
            this.subscribedScene = scene;
        }
    }

    protected unsubscribe()
    {
        if (this.subscribedScene) {
            this.subscribedScene.off<ISceneBeforeRenderEvent>("before-render", this.onBeforeRender, this);
            this.subscribedScene.off<ISceneAfterRenderEvent>("after-render", this.onAfterRender, this);
            this.subscribedScene = null;
        }
    }

    protected onActiveScene()
    {
        if (this.objects.size > 0) {
            this.subscribe();
        }
    }

    protected onBeforeRender(event: ISceneBeforeRenderEvent)
    {
        if (!this.nexus) {
            return;
        }

        const gl = event.context.renderer.getContext() as WebGLRenderingContext;
        this.nexus.beginFrame(gl);
    }

    protected onAfterRender(event: ISceneAfterRenderEvent)
    {
        if (!this.nexus) {
            return;
        }
        const gl = event.context.renderer.getContext() as WebGLRenderingContext;
        this.nexus.endFrame(gl);

        // The Nexus runtime draws its patches with raw WebGL (bindBuffer,
        // vertexAttribPointer, and activeTexture/bindTexture for each node's
        // texture). Those calls mutate GL state three.js doesn't track, so its
        // cached active-texture-unit drifts and on a later frame three binds the
        // environment map to the wrong unit — corrupting image-based lighting
        // (renders washed-out/white-ish, most visibly in Chrome). Resync three's
        // state cache once per frame, AFTER the whole scene has rendered (doing it
        // mid-render, in the mesh's onAfterRender, corrupts the current frame).
        event.context.renderer.resetState();
    }
}
