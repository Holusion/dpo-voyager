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

////////////////////////////////////////////////////////////////////////////////

/**
 * Minimal typing of the global `Nexus` namespace exposed by the vendored
 * `assets/js/nexus/nexus.js`. The library is loaded as a classic (non-module)
 * script because it locates its decompression workers (meco.js, corto.em.js)
 * by inspecting its own `<script src>` attribute, and builds them as Web Workers.
 */
export interface INexus
{
    /** Constructs a mesh: the loadable `.nxz`/`.nxs` resource, independent of any GL context. */
    Mesh: new () => INexusMesh;
    /** Renderable instance bound to a GL context. `Renderer` and `Renderable` are aliases of `Instance`. */
    Instance: new (gl: WebGLRenderingContext) => INexusInstance;
    Renderer: new (gl: WebGLRenderingContext) => INexusInstance;
    Renderable: new (gl: WebGLRenderingContext) => INexusInstance;

    /** Global debug flags. `nodes` tints each rendered node by its LOD error. */
    Debug: { verbose: boolean; nodes: boolean; draw: boolean; extract: boolean };
    /** Per-GL-context bookkeeping; one entry per context that has loaded a mesh. */
    contexts: any[];

    beginFrame(gl: WebGLRenderingContext, fps?: number): void;
    endFrame(gl: WebGLRenderingContext): void;
    updateCache(gl: WebGLRenderingContext): void;
    flush(context: any, mesh: any): void;

    setTargetError(gl: WebGLRenderingContext, error: number): void;
    setMinFps(gl: WebGLRenderingContext, fps: number): void;
    setMaxCacheSize(gl: WebGLRenderingContext, size: number): void;
    /**
     * Sharpens the camera-distance falloff of node priority so the bounded cache
     * is concentrated on the front-and-center node(s) (loaded first, evicted last)
     * instead of split evenly across the model. 0 = stock upstream behaviour;
     * higher = more aggressive focus. Normalised to 1 at the dataset centre, so
     * the focus's effective target error is unchanged. See nexus.js prominenceBias.
     */
    setProminenceBias(gl: WebGLRenderingContext, bias: number): void;
    getTargetError(gl: WebGLRenderingContext): number;
    getMinFps(gl: WebGLRenderingContext): number;
    getMaxCacheSize(gl: WebGLRenderingContext): number;
    getProminenceBias(gl: WebGLRenderingContext): number;
}

export interface INexusMesh
{
    url: string;
    useIndexedDb: boolean;
    isReady: boolean;
    onLoad: () => void;
    open(url: string): void;
}

export interface INexusInstance
{
    context: any;
    mesh: any;
    attributes: any;
    isReady: boolean;
    mode: string;
    pointsize: number;
    pointscale: number;
    onLoad: () => void;
    onUpdate: () => void;
    open(url: string): void;
    updateView(viewport: number[], projection: ArrayLike<number>, modelView: ArrayLike<number>): void;
    render(): void;
}

////////////////////////////////////////////////////////////////////////////////

// Path to the vendored nexus.js. Must contain the literal "nexus.js" so the
// library can derive the sibling worker URLs (meco.js / corto.em.js).
let scriptPath = "js/nexus/nexus.js";
let loadingPromise: Promise<INexus> = null;

export function setNexusScriptPath(path: string)
{
    scriptPath = path;
}

export function loadNexus(): Promise<INexus>
{
    const existing = (window as any).Nexus as INexus;
    if (existing) {
        return Promise.resolve(existing);
    }
    if (loadingPromise) {
        return loadingPromise;
    }

    loadingPromise = new Promise<INexus>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = scriptPath;
        script.async = true;
        script.onload = () => {
            const nexus = (window as any).Nexus as INexus;
            if (nexus) {
                resolve(nexus);
            }
            else {
                reject(new Error("nexus.js loaded but the 'Nexus' global is missing"));
            }
        };
        script.onerror = () => {
            loadingPromise = null;
            reject(new Error(`failed to load nexus.js from '${scriptPath}'`));
        };
        document.head.appendChild(script);
    });

    return loadingPromise;
}
