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
    Matrix4,
    Ray,
    Triangle,
    DataTexture,
    RGBAFormat,
    MeshBasicMaterial,
    MeshStandardMaterial,
    WebGLRenderer,
    Scene,
    Camera,
    Raycaster,
    Intersection,
} from "three";

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

        instance.onLoad = () => {
            const nx = instance.mesh;
            const c = nx.sphere.center;
            geometry.boundingSphere = new Sphere(new Vector3(c[0], c[1], c[2]), nx.sphere.radius);
            geometry.boundingBox = this.computeBoundingBox();

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
            const makeMaterial = (params: any) =>
                hasNormals ? new MeshStandardMaterial({ roughness: 1, metalness: 0, ...params })
                           : new MeshBasicMaterial(params);

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
                    this.material = makeMaterial({ color: 0xffffff, map: makeWhiteTexture() });
                }
            }
            else if (hasColors) {
                geometry.setAttribute("color", new BufferAttribute(new Float32Array(3), 3));
                if (this.autoMaterial) {
                    this.material = makeMaterial({ vertexColors: true });
                }
            }
            else if (this.autoMaterial) {
                this.material = makeMaterial({ color: 0xffffff });
            }

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
        let pickBefore: Function = null;
        let pickAfter: Function = null;

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
                // During a GPUPicker pass the scene override material is the index
                // shader: let the picker run and skip Nexus drawing for that pass.
                if (m && (m as any).isIndexShader) {
                    if (pickAfter) pickAfter.call(this, r, s, c, g, m, grp);
                    return;
                }
                this.renderNexus(r, s, c, g, m);
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
    protected renderNexus(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, material: Material)
    {
        const gl = renderer.getContext() as WebGLRenderingContext;
        const instance: INexusInstance = (geometry as any).instance;
        if (!instance || !instance.isReady) {
            return;
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
        this.nexus.updateCache(gl);
    }

    computeBoundingBox(): Box3
    {
        const nexus = this.instance.mesh;
        if (!nexus.sphere) {
            return null;
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

    raycast(raycaster: Raycaster, intersects: Intersection[])
    {
        const instance = this.instance;
        if (!instance) {
            return;
        }
        const nexus = instance.mesh;
        if (!nexus.sphere) {
            return;
        }

        const c = nexus.sphere.center;
        const sphere = new Sphere(new Vector3(c[0], c[1], c[2]), nexus.sphere.radius);
        sphere.applyMatrix4(this.matrixWorld);

        const inverse = new Matrix4().copy(this.matrixWorld).invert();
        const ray = new Ray().copy(raycaster.ray).applyMatrix4(inverse);

        const probe = new Vector3();
        if (!raycaster.ray.intersectSphere(sphere, probe)) {
            return;
        }

        // only the coarse (base) mesh is used for picking
        if (!nexus.sink || !nexus.basei) {
            return;
        }

        const vert = nexus.basev;
        const tri = nexus.basei;

        const A = new Vector3();
        const B = new Vector3();
        const C = new Vector3();
        const point = new Vector3();
        let distance = -1.0;
        let intersect: Vector3 = null;
        let face: any = {};

        for (let j = 0; j < tri.length; j += 3) {
            const a = tri[j];
            const b = tri[j + 1];
            const c2 = tri[j + 2];
            A.set(vert[a * 3], vert[a * 3 + 1], vert[a * 3 + 2]);
            B.set(vert[b * 3], vert[b * 3 + 1], vert[b * 3 + 2]);
            C.set(vert[c2 * 3], vert[c2 * 3 + 1], vert[c2 * 3 + 2]);

            const hit = ray.intersectTriangle(C, B, A, false, point);
            if (!hit) {
                continue;
            }

            hit.applyMatrix4(this.matrixWorld);
            const d = hit.distanceTo(raycaster.ray.origin);
            if (d < raycaster.near || d > raycaster.far) {
                continue;
            }
            if (distance == -1.0 || d < distance) {
                distance = d;
                intersect = hit.clone();
                face = { a, b, c: c2, normal: new Vector3() };
                Triangle.getNormal(A, B, C, face.normal);
            }
        }

        if (distance == -1.0) {
            return;
        }
        intersects.push({ distance, point: intersect, face, object: this } as Intersection);
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
    texture.needsUpdate = true;
    return texture;
}
