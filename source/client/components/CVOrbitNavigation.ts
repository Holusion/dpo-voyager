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

import { Box3, Euler, Sphere, Quaternion, Vector3, Matrix4, Plane, Ray, Vector2 } from "three";

import CObject3D, { Node, types } from "@ff/scene/components/CObject3D";

import CameraController from "@ff/three/CameraController";
import { IKeyboardEvent, IPointerEvent, ITriggerEvent } from "@ff/scene/RenderView";
import CScene, { IRenderContext } from "@ff/scene/components/CScene";
import CTransform, { ERotationOrder } from "@ff/scene/components/CTransform";
import { EProjection } from "@ff/three/UniversalCamera";

import { ENavigationType, TNavigationType, INavigation } from "client/schema/setup";

import CVScene from "./CVScene";
import CVAssetManager from "./CVAssetManager";
import CVARManager from "./CVARManager";
import CVModel2 from "./CVModel2";
import { EDerivativeQuality, EDerivativeUsage } from "client/schema/model";
import { getMeshTransform } from "client/utils/Helpers";
import { DEG2RAD, RAD2DEG } from "three/src/math/MathUtils";

////////////////////////////////////////////////////////////////////////////////

export { EProjection };

export enum EViewPreset { Left, Right, Top, Bottom, Front, Back, None };
export enum EKeyNavMode { Orbit, Zoom, Pan };

const sizeMap ={
    [EDerivativeQuality.Thumb]: 512*512,
    [EDerivativeQuality.Low]: 1024*1024,
    [EDerivativeQuality.Medium]: 2048*2048,
    [EDerivativeQuality.High]: 4096*4096,
} as const;



const _orientationPresets = [];
_orientationPresets[EViewPreset.Left] = [ 0, -90, 0 ];
_orientationPresets[EViewPreset.Right] = [ 0, 90, 0 ];
_orientationPresets[EViewPreset.Front] = [ 0, 0, 0 ];
_orientationPresets[EViewPreset.Back] = [ 0, 180, 0 ];
_orientationPresets[EViewPreset.Top] = [ -90, 0, 0 ];
_orientationPresets[EViewPreset.Bottom] = [ 90, 0, 0 ];


const _replaceNull = function(vector: number[], replacement: number)
{
    for (let i = 0, n = vector.length; i < n; ++i) {
        vector[i] = vector[i] === null ? replacement : vector[i];
    }
    return vector;
};

/**
 * Voyager explorer orbit navigation.
 * Controls manipulation and parameters of the camera.
 */
export default class CVOrbitNavigation extends CObject3D
{
    static readonly typeName: string = "CVOrbitNavigation";

    static readonly text: string = "Orbit Navigation";
    static readonly icon: string = "";

    protected static readonly ins = {
        enabled: types.Boolean("Settings.Enabled", true),
        pointerEnabled: types.Boolean("Settings.PointerEnabled", true),
        promptEnabled: types.Boolean("Settings.PromptEnabled", true),
        isInUse: types.Boolean("Camera.IsInUse", false),
        preset: types.Enum("Camera.ViewPreset", EViewPreset, EViewPreset.None),
        lightsFollowCamera: types.Boolean("Navigation.LightsFollowCam", true),
        autoRotation: types.Boolean("Navigation.AutoRotation", false),
        autoRotationSpeed: types.Number("Navigation.AutoRotationSpeed", 10),
        zoomExtents: types.Event("Settings.ZoomExtents"),
        autoZoom: types.Boolean("Settings.AutoZoom", true),
        orbit: types.Vector3("Current.Orbit", [ -25, -25, 0 ]),
        offset: types.Vector3("Current.Offset", [ 0, 0, 100 ]),
        pivot: types.Vector3("Current.Pivot", [ 0, 0, 0 ]),
        minOrbit: types.Vector3("Limits.Min.Orbit", [ -90, -Infinity, -Infinity ]),
        minOffset: types.Vector3("Limits.Min.Offset", [ -Infinity, -Infinity, 0.1 ]),
        maxOrbit: types.Vector3("Limits.Max.Orbit", [ 90, Infinity, Infinity ]),
        maxOffset: types.Vector3("Limits.Max.Offset", [ Infinity, Infinity, Infinity ]),
        keyNavActive: types.Enum("Navigation.KeyNavActive", EKeyNavMode),
        promptActive: types.Boolean("Navigation.PromptActive", false)
    };

    ins = this.addInputs<CObject3D, typeof CVOrbitNavigation.ins>(CVOrbitNavigation.ins);

    private _controller = new CameraController();
    private _scene: CScene = null;
    private _modelBoundingBox: Box3 = null;
    private _hasChanged = false;
    private _hasZoomed = false;
    private _isAutoZooming = false;
    private _autoRotationStartTime = null;
    private _initYOrbit = null;

    constructor(node: Node, id: string)
    {
        super(node, id);
        this._scene = this.scene;
    }

    get settingProperties() {
        return [
            this.ins.enabled,
            this.ins.orbit,
            this.ins.offset,
            this.ins.pivot,
            this.ins.autoZoom,
            this.ins.autoRotation,
            this.ins.autoRotationSpeed,
            this.ins.lightsFollowCamera,
            this.ins.minOrbit,
            this.ins.minOffset,
            this.ins.maxOrbit,
            this.ins.maxOffset,
        ];
    }

    get snapshotProperties() {
        return [
            this.ins.orbit,
            this.ins.offset,
            this.ins.pivot,
        ];
    }

    protected get assetManager() {
        return this.getMainComponent(CVAssetManager);
    }
    protected get sceneNode() {
        return this.getSystemComponent(CVScene);
    }
    protected get arManager() {  // HACK - need a centralized place to reference shadowRoot of this instance
        return this.getSystemComponent(CVARManager);
    }

    create()
    {
        super.create();

        this.system.on<IPointerEvent>(["pointer-down", "pointer-up", "pointer-move"], this.onPointer, this);
        this.system.on<ITriggerEvent>("double-click", this.onDoubleClick, this);
        this.system.on<ITriggerEvent>("wheel", this.onTrigger, this);
        this.system.on<IKeyboardEvent>("keydown", this.onKeyboard, this);

        this.assetManager.outs.completed.on("value", this.onLoadingCompleted, this);
    }

    dispose()
    {
        this.assetManager.outs.completed.off("value", this.onLoadingCompleted, this);

        this.system.off<IPointerEvent>(["pointer-down", "pointer-up", "pointer-move"], this.onPointer, this);
        this.system.off<ITriggerEvent>("wheel", this.onTrigger, this);
        this.system.off<IKeyboardEvent>("keydown", this.onKeyboard, this);

        super.dispose();
    }

    update()
    {
        const ins = this.ins;
        const controller = this._controller;

        const cameraComponent = this._scene.activeCameraComponent;
        const camera = cameraComponent ? cameraComponent.camera : null;

        const { preset, orbit, offset, pivot } = ins;


        // camera preset
        if (preset.changed && preset.value !== EViewPreset.None) {
            orbit.setValue(_orientationPresets[preset.getValidatedValue()].slice());
        }

        // include lights
        if (ins.lightsFollowCamera.changed) {
            const lightTransform = this.getLightTransform();
            if (lightTransform) {
                if (ins.lightsFollowCamera.value) {
                    lightTransform.ins.order.setValue(ERotationOrder.ZXY);
                    lightTransform.ins.rotation.reset();
                    lightTransform.ins.rotation.linkFrom(orbit, 1, 1);
                }
                else {
                    lightTransform.ins.rotation.unlinkFrom(orbit, 1, 1);
                    lightTransform.ins.rotation.reset();
                }
            }
        }

        const { minOrbit, minOffset, maxOrbit, maxOffset} = ins;

        // orbit, offset and limits
        if (orbit.changed || offset.changed || pivot.changed) {
            controller.orbit.fromArray(orbit.value);
            controller.offset.fromArray(offset.value);
            controller.pivot.fromArray(pivot.value);
        }

        if (minOrbit.changed || minOffset.changed || maxOrbit.changed || maxOffset.changed) {
            controller.minOrbit.fromArray(minOrbit.value);
            controller.minOffset.fromArray(minOffset.value);
            controller.maxOrbit.fromArray(maxOrbit.value);
            controller.maxOffset.fromArray(maxOffset.value);
        }

        // zoom extents
        if (camera && ins.zoomExtents.changed) {
            const scene = this.getGraphComponent(CVScene);
            if(scene.models.some(model => model.outs.updated.changed)) {
                scene.update(null);
            }
            this._modelBoundingBox = scene.outs.boundingBox.value;
            if(this._isAutoZooming && (!this.ins.autoZoom.value || this._modelBoundingBox.isEmpty())) {
                /*edge case when loaded event triggers before document parsing */
            }
            else {
                // Hack until we have a better way to make sure camera is initialized on first zoom
                if(controller.camera) {
                    cameraComponent.camera.aspect = controller.camera.aspect;
                }

                controller.camera = cameraComponent.camera;
            
                controller.zoomExtents(this._modelBoundingBox);
                cameraComponent.ins.zoom.set();
                this._hasZoomed = true;
            }
            this._isAutoZooming = false;
        }

        // auto rotate
        if (ins.autoRotation.changed) {
            this._autoRotationStartTime = ins.autoRotation.value ? performance.now() : null;
        }
        if (ins.promptActive.changed && !this._autoRotationStartTime) {
            this._initYOrbit = controller.orbit.y;
            this._autoRotationStartTime = ins.promptActive.value ? performance.now() : null;
        }

        return true;
    }

    tick()
    {
        const ins = this.ins;
        const cameraComponent = this._scene.activeCameraComponent;

        if (!ins.enabled.value || !cameraComponent) {
            return;
        }

        const controller = this._controller;
        controller.camera = cameraComponent.camera;

        const transform = cameraComponent.transform;
        const forceUpdate = this.changed || ins.autoRotation.value || ins.promptActive.value;

        if ((ins.autoRotation.value || ins.promptActive.value) && this._autoRotationStartTime) {
            const now = performance.now();
            const delta = (now - this._autoRotationStartTime) * 0.001;
            if(ins.autoRotation.value) {
                // auto-rotation function
                controller.orbit.y = (controller.orbit.y + ins.autoRotationSpeed.value * delta) % 360.0;
                this._autoRotationStartTime = now;
            }
            else {
                const prompt = this.arManager.shadowRoot.getElementById("prompt") as HTMLElement;

                if(prompt) {
                    // prompt rotation function
                    const pause = 2.0;
                    const period = 1.5;
                    const cycle = 2.0 * period;
                    const fadeLength = 0.2 * period;
                    let deltaMod = delta % (cycle + pause);
                    if(deltaMod > cycle && deltaMod < cycle + pause) {
                        prompt.style.opacity = deltaMod < cycle + fadeLength ? `${1.0 - ((deltaMod - cycle) / fadeLength)}` : "0.0";
                        deltaMod = 0.0;
                    }
                    else if(deltaMod < fadeLength) {
                        prompt.style.opacity = deltaMod < fadeLength ? `${deltaMod / fadeLength}` : "1.0";
                    }
                    
                    const promptOffset = Math.sin((deltaMod/period) * Math.PI) * 20.0;
                    controller.orbit.y = this._initYOrbit + promptOffset;
            
                    prompt.style.transform = `translateX(${-4*promptOffset}px)`;
                }
            }
        }

        if (controller.updateCamera(transform.object3D, forceUpdate)) {
            controller.orbit.toArray(ins.orbit.value);
            ins.orbit.set(true);
            controller.offset.toArray(ins.offset.value);
            ins.offset.set(true);

            // if camera has moved, set preset to "None"
            if (ins.preset.value !== EViewPreset.None && !ins.preset.changed) {
                ins.preset.setValue(EViewPreset.None, true);
            }
            
            if(!ins.isInUse.value && this._hasChanged) {
                ins.isInUse.setValue(true);
            }

            if (transform) {
                transform.setPropertiesFromMatrix();
            }
            else {
                cameraComponent.setPropertiesFromMatrix();
            }

            /**
             * Dynamic LOD handling.
             * @fixme Vectors allocations should be moved to module scope once things stabilize.
             *      They are kept here for now for readability
             * 
             * @fixme we currently don't account for viewport size which might be an interesting modifier
             *      ie. smaller (as in pixels as much as physical size) screens might need smaller
             * 
             * 
             */

            /**
             * Applies a modifier depending on the model's center position on screen
             * Models near the center of screen are considered more important than near corners
             * A coefficient of 0.5 means a model whose center is right at the edge of the screen
             * is half as important as a centered model of equal size
             * @fixme using min/max might be more pertinent 
             * Don't go below 25% of original weight
             */
            function centerWeight(pt :Vector2|Vector3){
                return Math.sqrt(Math.max(1 - 0.5*Math.abs(pt.x) - 0.5*Math.abs(pt.y), 1/16));
            }

            /**
             * How far from center is the centermost part of the object?
             * 1: Object crosses the image's center
             */
            function maxCenterWeight(b :Box3){
                let dx = Math.max(-b.max.x, b.min.x, 0);
                let dy = Math.max(-b.max.y, b.min.y, 0);
                return 1 / (1+dx+dy);
            }

            /**
             * Applies a modifier using Z depth
             * Keep in mind that actual depth decay is already accounted-for naturally through screen-space coordinates
             * 
             */
            function depthWeight(min:number, max:number){
                if(max < -1 || 1 < min ) return 0;
                //Actual depth when within near/far bounds is already accounted-for
                //through NDC projection. We could however implement some kind of exponential decay here
                if(-1 < min && max < 1 ) return 1;
                return 1 - 2/(Math.max(1,max-1) - Math.min(-1, min+1));
            }

            const hyst = 0.02; //In absolute % of screen area unit
            const steps = [
                [0.03, EDerivativeQuality.Thumb],
                [0.10, EDerivativeQuality.Low],
                [0.3, EDerivativeQuality.Medium],
            ];
            /**
             * Calculate desired quality setting agressively.
             * 
             * An hysteresis is necessary to prevent flickering, 
             * but it would be interesting to configure if we upgrade-first or downgrade-first
             * depending on resources contention 
             * 
             * @fixme here we should take into account the renderer's resolution:
             * we probably don't need a 4k texture when rendering an object over 40% of a 800px viewport
             */
            function getQuality(current :EDerivativeQuality, relSize:number){
                return steps.find(([size, q])=>{
                    if (current <= q) size += hyst;
                    return relSize < size;
                })?.[1] ?? EDerivativeQuality.High;
            }

            const box = new Box3();
            const point = new Vector3(0, 0, 0);

            const models :Array<{model:CVModel2, weight:number, relSize:number, quality : EDerivativeQuality}> = this.getGraphComponents(CVModel2).map(model=>{
                box.makeEmpty();
                const scale = model.outs.unitScale.value;
                let b = model.localBoundingBox.clone().applyMatrix4(new Matrix4().compose(
                    new Vector3(...model.transform.ins.position.value).multiplyScalar(scale),
                    new Quaternion().setFromEuler(new Euler(...model.transform.ins.rotation.value, "XYZ" as any)),
                    new Vector3(...model.transform.ins.scale.value).multiplyScalar(scale),
                ));
                //console.debug("Box:", b.min.toArray(), b.max.toArray(), cameraComponent.camera.position.toArray());
                [
                    [b.min.x, b.min.y, b.min.z],
                    [b.max.x, b.min.y, b.min.z],
                    [b.max.x, b.max.y, b.min.z],
                    [b.max.x, b.max.y, b.max.z],
                    [b.min.x, b.max.y, b.max.z],
                    [b.min.x, b.min.y, b.max.z],
                    [b.max.x, b.min.y, b.max.z],
                    [b.min.x, b.max.y, b.min.z],
                ].forEach((coords:[number, number, number], index)=>{
                    point.set(...coords).project(cameraComponent.camera);
                    box.expandByPoint(point);
                });
                //console.debug("NDC : ", box.min.toArray(), box.max.toArray());
                //We want % of screen surface that would be used if the object was centered
                box.getSize(point);
                const relSize = (point.x *point.y)/4;
                let center = box.getCenter(point);
                /**
                 * Weight (object's perceived importance) is separate from relSize (object's scale relative to screen)
                 * because we don't want to downscale objects that become invisible too agressively when we can avoid it.
                 */
                let weight = relSize*maxCenterWeight(box)*depthWeight(box.min.z, box.max.z);
                
                /**
                 * Calculate the expected quality for the given relative size
                 */
                const current = model.ins.quality.value;
                let quality :EDerivativeQuality = getQuality(current, weight);
                console.debug(
                    `${model.ins.name.value} quality :`
                    +` ${quality} ${Math.round(relSize*100)}% screen size`
                    +` (${center.x.toFixed(2)}, ${center.y.toFixed(2)}) ${Math.round(maxCenterWeight(box)*100)}% centered`
                    +` ${Math.round((depthWeight(box.min.z, box.max.z))*100)}% Z-mod` );
                //*/
                return {model, weight, relSize, quality}
            });
            models.sort((a, b)=> a.weight - b.weight)
            //Texture size is counted in squares, we use total number of pixels
            const textureSpace = 16384; //Discrete GPUs have twice as much, but we are not trying to max-out
            let texSize = 0;
            // 2 maps of 512px per thumbnails models
            // Then a few 1024px maps for shadow maps
            // We are not trying to minmax things here, just eyeballing how texture-contrained we expect to be
            let reserved = 2*models.length * 512 * 512 + 1024*1024*4; 
            let downgrades = {};
            models.forEach(m=>{
                reserved -= 512*512;
                while((16384*16384 - reserved) < texSize + sizeMap[m.quality] && EDerivativeQuality.Thumb < m.quality){
                    downgrades[m.quality]= (downgrades[m.quality] ?? 0) +1;
                    m.quality--;
                }
                texSize+= sizeMap[m.quality];
            });
            if(Object.keys(downgrades).length) console.debug("Downgrade : ", downgrades);

            //console.debug("%d models in view", models.filter(m=>m.weight !== 0).length);

            for(let {model, quality, weight} of models){
                const current = model.ins.quality.value;
                
                //Check for cases where we won't update quality
                if(quality == current) continue;
                else if(current < quality && !weight) continue; //Don't upgrade when not visible, but do downgrade

                const bestMatchDerivative = model.derivatives.select(EDerivativeUsage.Web3D, quality);
                if(bestMatchDerivative && bestMatchDerivative.data.quality != current ){
                    console.debug("Set quality for ", model.ins.name.value, " from ", current, " to ", bestMatchDerivative.data.quality);
                    model.ins.quality.setValue(bestMatchDerivative.data.quality);
                }
            }
            return true;
        }

        return false;
    }

    projectPointOnPlaneTowardsCamera(
        point: Vector3,
        plane: THREE.Plane,
        camera: Vector3
    ) {
        const direction = new Vector3();
        direction.copy(camera).sub(point).normalize();
        const ray = new Ray(point, direction);
        return ray.intersectPlane(plane, new Vector3());
    }

    preRender(context: IRenderContext)
    {
        if (this._modelBoundingBox) {
            context.viewport.zoomExtents(this._modelBoundingBox);
        }
    }

    setChanged(changed: boolean)
    {
        this._hasChanged = changed;
    }

    tock()
    {
        this._modelBoundingBox = null;
        return false;
    }

    fromData(data: INavigation)
    {
        data = data || {} as INavigation;

        const orbit = data.orbit || {
            orbit: [ -25, -25, 0 ],
            offset: [ 0, 0, 100 ],
            minOrbit: [ -90, -Infinity, -Infinity ],
            minOffset: [ -Infinity, -Infinity, 0.1 ],
            maxOrbit: [ 90, Infinity, Infinity ],
            maxOffset: [ Infinity, Infinity, Infinity ],
        };

        this.ins.copyValues({
            enabled: !!data.enabled,
            autoZoom: !!data.autoZoom,
            autoRotation: !!data.autoRotation,
            lightsFollowCamera: !!data.lightsFollowCamera,
            orbit: orbit.orbit,
            offset: orbit.offset,
            pivot: orbit.pivot || [ 0, 0, 0 ],
            minOrbit: _replaceNull(orbit.minOrbit, -Infinity),
            maxOrbit: _replaceNull(orbit.maxOrbit, Infinity),
            minOffset: _replaceNull(orbit.minOffset, -Infinity),
            maxOffset: _replaceNull(orbit.maxOffset, Infinity),
        });
    }

    toData(): INavigation
    {
        const ins = this.ins;
        const data: Partial<INavigation> = {};

        data.enabled = ins.enabled.value;
        data.autoZoom = ins.autoZoom.value;
        data.autoRotation = ins.autoRotation.value;
        data.lightsFollowCamera = ins.lightsFollowCamera.value;

        data.type = "Orbit";

        data.orbit = {
            orbit: ins.orbit.cloneValue(),
            offset: ins.offset.cloneValue(),
            pivot: ins.pivot.cloneValue(),
            minOrbit: ins.minOrbit.cloneValue(),
            maxOrbit: ins.maxOrbit.cloneValue(),
            minOffset: ins.minOffset.cloneValue(),
            maxOffset: ins.maxOffset.cloneValue(),
        };

        return data as INavigation;
    }

    protected getLightTransform()
    {
        const lights = this.graph.findNodeByName("Lights");
        return lights && lights.getComponent(CTransform, true);
    }

    protected onPointer(event: IPointerEvent)
    {
        const viewport = event.viewport;

        // if viewport has it's own camera, don't handle event here
        if (viewport.camera) {
            return;
        }

        if (this.ins.enabled.value && this._scene.activeCameraComponent) {
            if (event.type === "pointer-down" && window.getSelection().type !== "None") {
                window.getSelection().removeAllRanges();
            }
            this._controller.setViewportSize(viewport.width, viewport.height);
            this._controller.onPointer(event);
            event.stopPropagation = true;
        }

        this._hasChanged = true;
    }

    protected onDoubleClick(event: ITriggerEvent){
        if(event.component?.typeName != "CVModel2") return;
        const model = event.component as CVModel2;
        const meshTransform = getMeshTransform(model.object3D, event.object3D);
        let pos = new Vector3(), rot = new Quaternion(), scale = new Vector3();
        model.transform.object3D.matrix.decompose(pos, rot, scale)

        //Add CVNode's transform
        const invMeshTransform = meshTransform.clone().invert();
        const bounds = model.localBoundingBox.clone().applyMatrix4(meshTransform);
        // add mesh's "pose".
        let localPosition = event.view.pickPosition(event as any, bounds)
            .applyMatrix4(invMeshTransform)      //Add internal transform
            .applyMatrix4(model.object3D.matrix) //Add mesh "pose"
            .applyMatrix4(model.transform.object3D.matrixWorld) //Add mesh's "transform" (attached CTransform)

        const orbit = new Vector3().fromArray(this.ins.orbit.value).multiplyScalar(DEG2RAD);
        const pivot = new Vector3().fromArray(this.ins.pivot.value);

        //we compute the new orbit and offset.z values to keep the camera in place
        let orbitRad = new Euler().setFromVector3(orbit, "YXZ");
        let orbitQuat = new Quaternion().setFromEuler(orbitRad);
        //Offset from pivot with applied rotation
        const offset = new Vector3().fromArray(this.ins.offset.value).applyQuaternion(orbitQuat);
        //Current camera absolute position
        const camPos = pivot.clone().add(offset);
        //We want the camera position to stay the same with the new parameters
        //First we need to get the path from the camera to the new pivot
        const clickToCam = camPos.clone().sub(localPosition);
        //We then use it to "look at" the new pivot
        orbitQuat.setFromUnitVectors(
            new Vector3(0, 0, 1),
            clickToCam.clone().normalize(),
        );

        //Rotation
        orbitRad.setFromQuaternion(orbitQuat, "YXZ");
        const orbitAngles = new Vector3().setFromEuler(orbitRad).multiplyScalar(RAD2DEG);
        

        //New pivot is straight-up where the user clicked
        this.ins.pivot.setValue(localPosition.toArray());
        //We always keep roll as-it-was because it tends to add up in disorienting ways
        this.ins.orbit.setValue([orbitAngles.x, orbitAngles.y, this.ins.orbit.value[2]]);
        this.ins.offset.setValue([0, 0, clickToCam.length()]);
    }

    protected onTrigger(event: ITriggerEvent)
    {
        const viewport = event.viewport;

        // if viewport has it's own camera, don't handle event here
        if (viewport.camera) {
            return;
        }

        if (this.ins.enabled.value && this._scene.activeCameraComponent) {
            this._controller.setViewportSize(viewport.width, viewport.height);
            this._controller.onTrigger(event);
            event.stopPropagation = true;
        }

        this._hasChanged = true;
    }

    protected onKeyboard(event: IKeyboardEvent)
    {
        const viewport = event.viewport;

        // if viewport has it's own camera, don't handle event here
        if (viewport.camera) {
            return;
        }

        if (this.ins.enabled.value && this._scene.activeCameraComponent) {
            if(event.key.includes("Arrow")) {
                if(event.ctrlKey) {
                    this.ins.keyNavActive.setValue(EKeyNavMode.Zoom);
                }
                else if(event.shiftKey) {
                    this.ins.keyNavActive.setValue(EKeyNavMode.Pan);
                }
                else {
                    this.ins.keyNavActive.setValue(EKeyNavMode.Orbit);
                }
            }
            this._controller.setViewportSize(viewport.width, viewport.height);
            if(this._controller.onKeypress(event)) {
                event.originalEvent.preventDefault();
            }
            event.stopPropagation = true;
        }

        this._hasChanged = true;
    }

    protected onLoadingCompleted(isLoading: boolean)
    {
        if (this.ins.autoZoom.value && (!this._hasChanged || !this._hasZoomed)) {
            this.ins.zoomExtents.set();
            this._isAutoZooming = true;
        }
    }
}