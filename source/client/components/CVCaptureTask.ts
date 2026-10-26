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

import { Dictionary } from "@ff/core/types";

import download from "@ff/browser/download";
import convert from "@ff/browser/convert";

import { Node, types } from "@ff/graph/Component";

import Notification from "@ff/ui/Notification";
import CRenderer from "@ff/scene/components/CRenderer";

import { EAssetType, EDerivativeQuality, EDerivativeUsage } from "client/schema/model";

import NVNode from "../nodes/NVNode";
import CVMeta from "./CVMeta";
import CVModel2 from "./CVModel2";
import CVAssetManager from "./CVAssetManager";
import CVAssetWriter from "./CVAssetWriter";
import CVStoryApplication from "./CVStoryApplication";
import CVTaskProvider, { ETaskMode } from "./CVTaskProvider";
import CVTask from "./CVTask";

import CaptureTaskView from "../ui/story/CaptureTaskView";
import { TImageQuality, TImageUsage } from "client/schema/meta";
import CVNodeProvider from "./CVNodeProvider";
import CVDocument from "./CVDocument";
import CVAnnotationView from "./CVAnnotationView";

////////////////////////////////////////////////////////////////////////////////

const _qualityLevels: EDerivativeQuality[] = [
    EDerivativeQuality.Thumb,
    EDerivativeQuality.Low,
    EDerivativeQuality.Medium,
    EDerivativeQuality.High
];

const _sizePresets: Dictionary<number[]> = {
    [EDerivativeQuality.Thumb]:  [320, 320],   // Thumb
    [EDerivativeQuality.Low]:    [640, 640],   // Low
    [EDerivativeQuality.Medium]: [1280, 1280], // Medium
    [EDerivativeQuality.High]:   [2560, 2560]  // High
};

export enum EFileType { JPEG, PNG }

const _mimeTypes = {
    [EFileType.JPEG]: "image/jpeg",
    [EFileType.PNG]: "image/png"
};

const _typeExtensions = {
    [EFileType.JPEG]: "jpg",
    [EFileType.PNG]: "png"
};


export default class CVCaptureTask extends CVTask
{
    static readonly typeName: string = "CVCaptureTask";

    static readonly text: string = "Capture";
    static readonly icon: string = "camera";

    protected static readonly ins = {
        take: types.Event("Picture.Take"),
        save: types.Event("Picture.Save"),
        download: types.Event("Picture.Download"),
        remove: types.Event("Picture.Remove"),
        type: types.Enum("Picture.Type", EFileType),
        quality: types.Percent("Picture.Quality", 0.85),
        saveSceneState: types.Event("State.Save"),
    };

    protected static readonly outs = {
        ready: types.Boolean("Picture.Ready"),
        updated: types.Boolean("Picture.Updated", false),
    };

    ins = this.addInputs<CVTask, typeof CVCaptureTask.ins>(CVCaptureTask.ins);
    outs = this.addOutputs<CVTask, typeof CVCaptureTask.outs>(CVCaptureTask.outs);

    activeMeta: CVMeta = null;
    activeModel: CVModel2 = null;
    isActiveScene: boolean = false;

    private _imageDataURIs: Dictionary<string> = {};
    private _imageElements: Dictionary<HTMLImageElement> = {};
    private _mimeType: string = "";
    private _extension: string = "";
    private _savingSceneState = false;

    constructor(node: Node, id: string)
    {
        super(node, id);

        const configuration = this.configuration;
        //configuration.interfaceVisible = false;
        //configuration.annotationsVisible = false;
        configuration.bracketsVisible = false;
        //configuration.gridVisible = false;
    }

    protected get renderer() {
        return this.getMainComponent(CRenderer);
    }
    protected get assetManager() {
        return this.getMainComponent(CVAssetManager);
    }
    protected get assetWriter() {
        return this.getMainComponent(CVAssetWriter);
    }
    protected get storyApplication() {
        return this.getMainComponent(CVStoryApplication);
    }
    protected get nodeProvider() {
        return this.getMainComponent(CVNodeProvider);
    }
    protected get setup() {
        return this.activeDocument.setup;
    }

    /** QC saves the model only and Standalone downloads a package, so neither saves the scene state. */
    get savesSceneState()
    {
        const mode = this.getMainComponent(CVTaskProvider).ins.mode.getValidatedValue();
        return mode !== ETaskMode.QC && mode !== ETaskMode.Standalone;
    }

    getImageElement(quality: EDerivativeQuality = EDerivativeQuality.Low)
    {
        return this._imageElements[quality];
    }

    createView()
    {
        return new CaptureTaskView(this);
    }

    activateTask()
    {
        // automatically select scene node
        this.nodeProvider.activeNode = this.nodeProvider.scopedNodes[0];
        
        super.activateTask();
    }

    update()
    {
        const ins = this.ins;

        if (ins.take.changed) {
            this.takeConfiguredPictures();
        }
        if (ins.save.changed) {
            this.savePictures()
            .then(() => new Notification("Saved thumbnail images.", "info", 4000))
            .catch(e => new Notification(`Failed to save thumbnail images: ${e.message}`, "error", 8000));
        }
        if (ins.saveSceneState.changed) {
            this.saveSceneState();
        }
        if (ins.download.changed) {
            this.downloadPicture();
        }
        if (ins.remove.changed) {
            this.removePictures();
        }

        return true;
    }

    /**
     * Caches the current setup as the scene state, adds a thumbnail if the scene has none, and saves the document.
     * Reports a single outcome, so a failure at any step is reported as an unsaved scene.
     */
    protected async saveSceneState()
    {
        if (this._savingSceneState) {
            return;
        }
        this._savingSceneState = true;

        try {
            this.setup.cacheSetupState();

            const root = this.activeDocument.root;
            const hasThumbnail = !!root.meta?.images.items.some(image => image.usage === "Render");
            if (!hasThumbnail) {
                this.activeMeta = root.meta || root.createComponent(CVMeta);
                this.takeConfiguredPictures();
                await this.savePictures();
            }

            await this.storyApplication.saveDocument();
            new Notification(hasThumbnail ? "Scene state saved." : "Scene state and thumbnail saved.", "success", 4000);
        }
        catch (e) {
            new Notification(`Scene NOT saved: ${e.message}. Save again before leaving.`, "error", 0);
        }
        finally {
            this._savingSceneState = false;
        }
    }

    protected takeConfiguredPictures()
    {
        const typeIndex = this.ins.type.getValidatedValue();
        this.takePictures(this.ins.quality.value, _mimeTypes[typeIndex], _typeExtensions[typeIndex]);
    }

    protected takePictures(compressionQuality: number, type: string, extension: string)
    {
        this._mimeType = type;
        this._extension = extension;

        const view = this.renderer.views[0];
        if (!view) {
            console.warn("can't render to image, no view attached");
            return;
        }

        const brackets = this.selection.ins.viewportBrackets;
        const bracketsVisible = brackets.value;
        const annotationVisibility = this.getSystemComponents(CVAnnotationView).map(annotations => ({
            object: annotations.object3D, visible: annotations.object3D.visible,
        }));
        try {
            brackets.setValue(false);
            this.selection.update();
            annotationVisibility.forEach(({ object }) => object.visible = false);

            _qualityLevels.forEach(quality => {
                const dataURI = view.renderImage(_sizePresets[quality][0], _sizePresets[quality][1], type, compressionQuality);
                this._imageDataURIs[quality] = dataURI;

                const imageElement = this._imageElements[quality] || document.createElement("img");
                imageElement.src = dataURI;
                this._imageElements[quality] = imageElement;
            });
        }
        finally {
            brackets.setValue(bracketsVisible);
            this.selection.update();
            annotationVisibility.forEach(({ object, visible }) => object.visible = visible);
        }

        this.outs.ready.setValue(true);
    }

    /** Uploads every image quality, and records them in the scene's meta only once all have been stored. */
    protected async savePictures()
    {
        if (!this.outs.ready.value) {
            throw new Error("no picture taken");
        }

        const mimeType = this._mimeType;
        const filePaths = _qualityLevels.map(quality => this.getImageAssetPath(quality, this._extension));
        await Promise.all(_qualityLevels.map((quality, index) =>
            this.assetWriter.put(convert.dataURItoBlob(this._imageDataURIs[quality]), mimeType, filePaths[index])));

        _qualityLevels.forEach((quality, index) => this.updateImageMeta(quality, mimeType, filePaths[index]));
    }

    protected downloadPicture()
    {
        if (!this.outs.ready.value) {
            return;
        }

        const dataURI = this._imageDataURIs[EDerivativeQuality.High];
        const filePath = this.getImageAssetPath(EDerivativeQuality.High, this._extension);
        const fileName = this.assetManager.getAssetName(filePath);
        download.url(dataURI, fileName);
    }

    protected updateImageMeta(quality: EDerivativeQuality, mimeType: string, uri: string)
    {
        const model = this.activeModel;
        const meta = this.activeMeta;

        const byteSize = Math.ceil(this._imageDataURIs[quality].length / 4 * 3);
        const width = _sizePresets[quality][0];
        const height = _sizePresets[quality][1];
        const imageSize = Math.max(width, height);

        if (model) {
            const derivative = model.derivatives.getOrCreate(EDerivativeUsage.Image2D, quality);
            const asset = derivative.findAsset(EAssetType.Image) || derivative.createAsset(EAssetType.Image, uri);
            asset.data.byteSize = byteSize;
            asset.data.imageSize = imageSize;
            asset.data.mimeType = mimeType;
            asset.update();
        }
        if (meta) {
            const qualityName = EDerivativeQuality[quality];
            meta.images.insert({
                uri,
                quality: qualityName as TImageQuality,
                byteSize,
                width,
                height,
                usage: "Render" as TImageUsage
            }, qualityName);
        }

        this.outs.updated.setValue(true);
    }

    protected getImageAssetPath(quality: EDerivativeQuality, extension: string)
    {
        let assetBaseName = this.activeDocument.assetBaseName;

        const qualityName = EDerivativeQuality[quality].toLowerCase();
        return `${assetBaseName}-image-${qualityName}.${extension}`;
    }

    protected removePictures()
    {
        console.warn("CCaptureTask.removePictures - not implemented yet");
    }

    protected onActiveDocument(previous: CVDocument, next: CVDocument)
    {
        super.onActiveDocument(previous, next);

        this.onActiveNode(previous?.root, next?.root);
    }

    protected onActiveNode(previous: NVNode, next: NVNode)
    {
        // Capture belongs to the scene, even when Settings selects another node.
        next = this.activeDocument?.root || null;
        if (this.activeMeta === (next?.meta || null)) {
            return;
        }
        previous = this.activeMeta?.node as NVNode;
        if (previous && previous.meta) {
            this.outs.ready.setValue(false);
            this._imageElements = {};
            this._imageDataURIs = {};
        }

        this.isActiveScene = next && next.scene ? true : false;

        const model = this.activeModel = next && next.model;
        const meta = this.activeMeta = next && next.meta;
        const images = meta && meta.images;

        if (images) {
            _qualityLevels.forEach(quality => {
                const imageMeta = images.items.find(image => image.quality === EDerivativeQuality[quality] && image.usage === "Render");
                //const imageMeta = images.get(EDerivativeQuality[quality]);
                if (imageMeta) {
                    const imageElement = document.createElement("img");
                    imageElement.src = this.assetManager.getAssetUrl(imageMeta.uri);
                    this._imageElements[quality] = imageElement;
                }
            })
        }
        else if (model) {
            _qualityLevels.forEach(quality => {
                const derivative = model.derivatives.get(EDerivativeUsage.Image2D, quality);
                if (derivative) {
                    const imageAsset = derivative.findAsset(EAssetType.Image);
                    if (imageAsset) {
                        const imageElement = document.createElement("img");
                        imageElement.src = this.assetManager.getAssetUrl(imageAsset.data.uri);
                        this._imageElements[quality] = imageElement;
                    }
                }
            });
        }
    }
}