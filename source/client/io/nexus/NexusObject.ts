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

import {
    Mesh,
    Material,
    BufferGeometry,
    BufferAttribute,
    Vector2,
    Vector3,
    Sphere,
    Box3,
    DataTexture,
    RGBAFormat,
    SRGBColorSpace,
    MeshBasicMaterial,
    MeshStandardMaterial,
    WebGLRenderer,
    Scene,
    Camera,
} from "three";

import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

import { INexus, INexusInstance } from "./loadNexus";

////////////////////////////////////////////////////////////////////////////////

/**
 * TypeScript port of the upstream `nexus_three.js` loader
 * (https://github.com/cnr-isti-vclab/nexus). A NexusObject is a streaming,
 * multiresolution Mesh: its geometry is refined every frame against the current
 * camera by the vendored `nexus.js` runtime. The object draws its own patches
 * from `onAfterRender`, so it can be added to a normal three.js scene graph.
 *
 * Differences from the original:
 *  - imports three.js symbols (no `THREE` global) for ESM/webpack builds
 *  - `RGBFormat` -> `RGBAFormat` and `THREE.VertexColors` -> `vertexColors: true`
 *    (both removed in modern three.js)
 *  - the `Nexus` runtime is injected rather than read from a global
 */

export interface INexusObjectOptions
{
    onLoad?: (object: NexusObject) => void;
    onUpdate?: (instance: INexusInstance) => void;
    material?: Material;
    /**
     * three.js KTX2 (Basis) texture loader. When supplied, the Nexus runtime
     * transcodes KTX2-compressed node textures through it and adopts the GPU
     * texture three creates (see `loadNodeTextureKTX2` in nexus.js); JPEG/PNG
     * node textures still take the `createImageBitmap` path. Must already be
     * configured (transcoder path + `detectSupport(renderer)`).
     */
    ktx2Loader?: KTX2Loader;
    /**
     * LOD heatmap mode: render each streamed node tinted red (coarse) -> green
     * (fine) so you can see what resolution is actually loaded. Uses an unlit
     * vertex-color material; the per-node tint is applied by the Nexus runtime
     * (requires `nexus.Debug.nodes = true`, set by the NexusReader).
     */
    heatmap?: boolean;
}

function nocenter(): never
{
    throw new Error("Centering (applying a matrix to the geometry) is unsupported for Nexus objects.");
}

export default class NexusObject extends Mesh
{
    /** True when no explicit material was supplied and one is derived from the file. */
    autoMaterial = false;

    /** The Nexus runtime namespace, kept for per-frame cache updates. */
    protected nexus: INexus;

    protected heatmap = false;

    georefData: any = null;

    /** Smoothed frames-per-second, sampled once per render in renderNexus. Debug only. */
    fps = 0;
    protected lastFrameTime = 0;

    constructor(nexus: INexus, url: string, renderer: WebGLRenderer, options: INexusObjectOptions = {})
    {
        const geometry = new BufferGeometry();
        (geometry as any).center = nocenter;
        geometry.setAttribute("position", new BufferAttribute(new Float32Array(3), 3));

        super(geometry, options.material);

        this.nexus = nexus;
        this.autoMaterial = !options.material;
        this.heatmap = !!options.heatmap;
        // Nexus manages visibility internally via its multiresolution structure.
        this.frustumCulled = false;

        const { onLoad, onUpdate } = options;
        const gl = renderer.getContext();

        const instance: INexusInstance = (geometry as any).instance = new nexus.Instance(gl as WebGLRenderingContext);
        instance.open(url);

        // Inject the three.js KTX2Loader so the Nexus runtime can transcode and
        // upload KTX2-compressed node textures. `instance.context` is created
        // synchronously by `open()`. The renderer is needed both to transcode
        // (its capabilities drive `detectSupport`) and to upload the resulting
        // GPU texture (`renderer.initTexture`); the runtime keeps the three
        // Texture so three retains ownership of the GPU handle. Non-KTX2 (JPEG/
        // PNG) node textures are unaffected and keep their image-decode path.
        if (options.ktx2Loader) {
            (instance.context as any).ktx2 = { renderer, loader: options.ktx2Loader };
        }

        this.nexus.setMinFps(renderer.getContext(), 30);
        this.nexus.setMaxCacheSize(renderer.getContext(), 1024*(1<<20));
        // Concentrate the bounded cache on the front-and-center node(s) so close
        // inspection reaches the finest LOD before the budget fills, rather than
        // spreading it evenly across the model. Tune up for tighter focus, or 0
        // for stock behaviour. See INexus.setProminenceBias / nexus.js.
        this.nexus.setProminenceBias(renderer.getContext(), 2.5);

        instance.onLoad = () => {
            const nx = instance.mesh;
            const c = nx.sphere.center;
            geometry.boundingSphere = new Sphere(new Vector3(c[0], c[1], c[2]), nx.sphere.radius);
            geometry.boundingBox = this.computeBoundingBox();
            this.installDebugStats();
            this.installBoundsProxy();

            const hasNormals = !!nx.vertex.normal;
            const hasColors = !!nx.vertex.color;
            const hasTexCoords = !!nx.vertex.texCoord;

            if (this.heatmap) {
                // Unlit vertex-color material; the Nexus runtime sets a constant
                // per-node colour (red coarse -> green fine) on the `color`
                // attribute, so a `color` attribute must exist in the geometry/shader.
                if (hasNormals) {
                    geometry.setAttribute("normal", new BufferAttribute(new Float32Array(3), 3));
                }
                geometry.setAttribute("color", new BufferAttribute(new Float32Array(3), 3));
                if (this.autoMaterial) {
                    this.material = new MeshBasicMaterial({ vertexColors: true });
                }
                const heatMaterial = this.material as Material & { defines?: Record<string, any> };
                if (heatMaterial && !heatMaterial.defines) {
                    heatMaterial.defines = {};
                }
                if (onLoad) {
                    onLoad(this);
                }
                return;
            }

            // Lit (MeshStandardMaterial) when the mesh has normals, so it picks up
            // Voyager's image-based environment lighting just like glTF models do.
            // Without normals fall back to an unlit MeshBasicMaterial so the mesh is
            // still visible (its vertex colours / texture carry the appearance).
            const makeMaterial = (params: any) =>new MeshStandardMaterial({ roughness: 1, metalness: 0, flatShading: false, fog: false, ...params });

            if (hasNormals) {
                geometry.setAttribute("normal", new BufferAttribute(new Float32Array(3), 3));
            }

            // Texture takes priority over vertex colours when a mesh has both:
            // the Nexus runtime binds the per-node texture to the `map` sampler, and
            // combining it with `vertexColors` multiplies the two (washing out the
            // texture and adding per-vertex colour noise on the finest nodes). Only
            // fall back to vertex colours when there is no texture. The interleaved
            // node data still carries colours; Nexus simply skips binding them when
            // the shader has no `color` attribute.
            if (hasTexCoords) {
                geometry.setAttribute("uv", new BufferAttribute(new Float32Array(2), 2));
                if (this.autoMaterial) {
                    this.material = makeMaterial({ color:0xffffff, map: makeWhiteTexture() });
                }
            }
            else if (this.autoMaterial) {
                this.material = makeMaterial({ });
            }
            console.log("Material:", this.material);

            // Voyager traverses every scene material to toggle shader defines
            // (e.g. CVSlicer's CUT_PLANE). three's built-in materials have no
            // `defines` object by default, so provide one to keep that safe.
            const material = this.material as Material & { defines?: Record<string, any> };
            if (material && !material.defines) {
                material.defines = {};
            }

            if (onLoad) {
                onLoad(this);
            }
        };

        instance.onUpdate = () => {
            if (onUpdate) {
                onUpdate(instance);
            }
        };

        this.installRenderHooks();
    }

    /**
     * The patches are drawn from `onAfterRender` (three.js has bound the shader
     * program by then). The catch: Voyager's GPUPicker overwrites
     * `onBeforeRender`/`onAfterRender` on every pickable object to drive ID-based
     * picking, and it does so *after* this object is added to the scene. To
     * coexist regardless of ordering we expose these as accessors that compose
     * the picker's handler (kept for picking) with our own Nexus rendering.
     */
    protected installRenderHooks()
    {
        let pickBefore: Function|null = null;
        let pickAfter: Function|null = null;

        Object.defineProperty(this, "onBeforeRender", {
            configurable: true,
            get: () => (r: any, s: any, c: any, g: any, m: any, grp: any) => {
                if (pickBefore) pickBefore.call(this, r, s, c, g, m, grp);
            },
            set: (fn: Function) => { pickBefore = fn; },
        });

        Object.defineProperty(this, "onAfterRender", {
            configurable: true,
            get: () => (r: WebGLRenderer, s: Scene, c: Camera, g: BufferGeometry, m: Material, grp: any) => {
                // During a GPUPicker pass the scene override material is one of the
                // pick shaders (index / position / normal). Voyager picks entirely on
                // the GPU: it renders the scene into a 1x1 target at the cursor and
                // reads back the pixel. A NexusObject only owns a 1-vertex dummy
                // geometry, so unless we draw the streamed patches with the pick
                // shader bound the patches are invisible to the picker and the model
                // is unpickable. renderNexus reuses whatever program three.js bound
                // (here the pick shader), and the pick shaders need only the
                // position/normal attributes the Nexus runtime already provides.
                const pick = m as any;
                const isPick = pick && (pick.isIndexShader || pick.isPositionShader || pick.isNormalShader);
                this.renderNexus(r, s, c, g, m, isPick);
                if (isPick && pickAfter) {
                    pickAfter.call(this, r, s, c, g, m, grp);
                }
            },
            set: (fn: Function) => { pickAfter = fn; },
        });
    }

    get instance(): INexusInstance
    {
        return (this.geometry as any).instance;
    }

    /**
     * Renders the currently resident patches. Called from the composed
     * `onAfterRender` accessor after three.js has issued the (dummy) draw call for
     * this mesh, so the correct shader program, uniforms and transforms are bound.
     */
    protected renderNexus(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, material: Material, isPick = false)
    {
        const gl = renderer.getContext() as WebGLRenderingContext;
        const instance: INexusInstance = (geometry as any).instance;
        if (!instance || !instance.isReady) {
            return;
        }

        // Sample FPS for the debug stats object. Voyager renders on demand, so this
        // tracks the rate during interaction and goes stale (last value) when idle.
        // Skip pick passes: they render several extra 1x1 frames per pointer event
        // and would otherwise pollute the rate.
        if (!isPick) {
            const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
            if (this.lastFrameTime) {
                const dt = now - this.lastFrameTime;
                if (dt > 0) {
                    const inst = 1000 / dt;
                    this.fps = this.fps ? this.fps * 0.9 + inst * 0.1 : inst;
                }
            }
            this.lastFrameTime = now;
        }

        const size = renderer.getSize(new Vector2());

        instance.updateView(
            [0, 0, size.width, size.height],
            camera.projectionMatrix.elements,
            this.modelViewMatrix.elements,
        );

        const program = gl.getParameter(gl.CURRENT_PROGRAM);

        const attr = instance.attributes;
        attr.position = gl.getAttribLocation(program, "position");
        attr.normal = gl.getAttribLocation(program, "normal");
        attr.color = gl.getAttribLocation(program, "color");
        attr.uv = gl.getAttribLocation(program, "uv");
        attr.size = gl.getUniformLocation(program, "size");
        attr.scale = gl.getUniformLocation(program, "scale");
        const mapLocation = gl.getUniformLocation(program, "map");
        attr.map = mapLocation ? gl.getUniform(program, mapLocation) : null;

        // detect whether three.js bound point or triangle shaders
        if (instance.mesh.face.index) {
            instance.mode = (material as any).isPointsMaterial ? "POINT" : "FILL";
        }
        if (attr.size != -1) {
            instance.pointsize = (material as any).size;
        }
        if (attr.scale != -1) {
            instance.pointscale = 2.0;
        }

        instance.render();
        if (!isPick) {
            this.nexus.updateCache(gl);
        }
    }

    /**
     * Debug only: breakdown of the resident GPU cache for this object, split into
     * geometry vs. texture bytes (matching the Nexus runtime's own cache
     * accounting, so `totalMB` ~ the budget that drives eviction). The texture
     * figure is the runtime's estimate (decoded JPEG/PNG size x10); shared
     * textures are counted per referencing node, exactly as the cache does.
     */
    cacheStats()
    {
        const instance = this.instance;
        const m = instance && instance.mesh;
        const ctx = instance && instance.context;
        if (!m || !ctx) {
            return null;
        }

        let geo = 0;
        let tex = 0;
        let ready = 0;
        let pending = 0;
        for (let i = 0; i < m.nodesCount; i++) {
            const status = m.status[i];
            if (status === 0) {
                continue;          // not in cache
            }
            status === 1 ? ready++ : pending++;
            const g = m.vsize * m.nvertices[i] + m.fsize * m.nfaces[i];
            geo += g;
            tex += Math.max(0, m.nsize[i] - g);
        }

        const MB = (b: number) => +(b / (1 << 20)).toFixed(2);
        return {
            residentNodes: ready,
            pendingNodes: pending,
            totalNodes: m.nodesCount,
            geometryMB: MB(geo),
            texturesMB: MB(tex),
            totalMB: MB(geo + tex),
            maxMB: MB(ctx.maxCacheSize),
            usage: +(100 * (geo + tex) / ctx.maxCacheSize).toFixed(1) + "%",
        };
    }


    /**
     * Debug only: publishes `window.nexusStats`, a live-getter object so reading any
     * property reflects the current frame. Assumes a single loaded object (the last
     * one to load wins). Cleared on dispose.
     */
    protected installDebugStats()
    {
        if (typeof window === "undefined") {
            return;
        }
        const self = this;
        const stats = {
            get fps() { return Math.round(self.fps); },
            get error() {
                const ctx = self.instance && self.instance.context;
                if (!ctx) {
                    return null;
                }
                // rendered = actual on-screen error achieved last frame (px);
                // target/current = the refinement threshold the traversal aims for.
                return {
                    rendered: +(ctx.realError || 0).toFixed(2),
                    target: ctx.targetError,
                    current: +(ctx.currentError || 0).toFixed(2),
                };
            },
            get cache() { return self.cacheStats(); },
            // Per-frame traversal limits. drawBudget caps the geometry drawn each
            // frame (independent of the cache budget): once drawSize exceeds it the
            // traversal stops expanding, so a `drawUsage` near 100% means on-screen
            // detail is capped by the draw budget, not the cache. selected = nodes
            // the last traversal chose to draw.
            get traversal() {
                const inst = self.instance as any;
                if (!inst || typeof inst.drawSize !== "number") {
                    return null;
                }
                let selected = 0;
                if (inst.selected) {
                    for (let i = 0; i < inst.selected.length; i++) {
                        selected += inst.selected[i];
                    }
                }
                const MB = (b: number) => +(b / (1 << 20)).toFixed(2);
                return {
                    selected,
                    drawMB: MB(inst.drawSize),
                    drawBudgetMB: MB(inst.drawBudget),
                    drawUsage: inst.drawBudget ? +(100 * inst.drawSize / inst.drawBudget).toFixed(0) + "%" : "n/a",
                    currentResolution: inst.currentResolution,
                };
            },
        };
        Object.defineProperty(stats, "__owner", { value: this, enumerable: false });
        (window as any).nexusStats = stats;
    }



    /**
     * Voyager derives a model's local bounding box (CVModel2, used as the range for
     * GPUPicker.pickPosition) by iterating each mesh's `position` *attribute* — it
     * ignores `geometry.boundingBox`. A NexusObject only carries a 1-vertex dummy
     * position, so without this the model's box collapses to a zero-size box at the
     * origin and every picked position decodes to that origin. Replace the dummy
     * with the 8 corners of the real bounding box (so the derived box is correct
     * even under a rotated parent transform), and set the draw range to 0 so the
     * no-op placeholder draw three.js issues (which still fires our render hooks)
     * renders none of them; the actual surface is drawn by renderNexus.
     */
    protected installBoundsProxy()
    {
        const box = this.geometry.boundingBox;
        if (!box) {
            return;
        }

        const { min, max } = box;
        const corners = new Float32Array([
            min.x, min.y, min.z,  max.x, min.y, min.z,
            min.x, max.y, min.z,  max.x, max.y, min.z,
            min.x, min.y, max.z,  max.x, min.y, max.z,
            min.x, max.y, max.z,  max.x, max.y, max.z,
        ]);
        this.geometry.setAttribute("position", new BufferAttribute(corners, 3));
        this.geometry.setDrawRange(0, 0);
    }

    computeBoundingBox(): Box3
    {
        const nexus = this.instance.mesh;
        if (!nexus.sphere) {
            return null!;
        }

        const min = new Vector3(Infinity, Infinity, Infinity);
        const max = new Vector3(-Infinity, -Infinity, -Infinity);

        // examine the spheres of the finest (sink) level patches
        for (let i = 0; i < nexus.sink; i++) {
            const patch = nexus.nfirstpatch[i];
            if (nexus.patches[patch * 3] != nexus.sink) {
                continue;
            }
            const x = nexus.nspheres[i * 5];
            const y = nexus.nspheres[i * 5 + 1];
            const z = nexus.nspheres[i * 5 + 2];
            const r = nexus.nspheres[i * 5 + 4]; // tight radius
            if (x - r < min.x) min.x = x - r;
            if (y - r < min.y) min.y = y - r;
            if (z - r < min.z) min.z = z - r;
            if (x + r > max.x) max.x = x + r;
            if (y + r > max.y) max.y = y + r;
            if (z + r > max.z) max.z = z + r;
        }

        return new Box3(min, max);
    }

    flush()
    {
        const instance = this.instance;
        this.nexus.flush(instance.context, instance.mesh);
    }

    /**
     * Releases the Nexus instance (GPU caches + worker bookkeeping) without
     * touching the three.js geometry. Safe to call more than once. This is what
     * runs when Voyager disposes the geometry through `disposeObject`.
     */
    releaseInstance()
    {
        const instance = this.instance;
        if (!instance) {
            return;
        }
        if (typeof window !== "undefined" && (window as any).nexusStats
            && (window as any).nexusStats.__owner === this) {
            delete (window as any).nexusStats;
        }

        const context = instance.context;
        const mesh = instance.mesh;
        this.nexus.flush(context, mesh);
        const index = context.meshes.indexOf(mesh);
        if (index >= 0) {
            context.meshes.splice(index, 1);
        }
        (this.geometry as any).instance = null;
    }

    dispose()
    {
        this.releaseInstance();
        this.geometry.dispose();
    }
}

function makeWhiteTexture(): DataTexture
{
    const texture = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat);
    // The Nexus runtime swaps in its own GL texture on the `map` sampler, so this
    // placeholder is never actually sampled. In WebGL2 the sRGB->linear decode of a
    // colour texture is done in hardware via its internal format (SRGB8_ALPHA8), not
    // by a shader define keyed on colorSpace -- so this placeholder's colorSpace has
    // no effect on the rendered result. The real decode is set where Nexus uploads
    // the texture (see `gl.SRGB8_ALPHA8` in nexus.js requestNodeTexture). We still
    // tag it sRGB for consistency with the glTF/GLB pipeline (see ModelReader).
    texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
}
