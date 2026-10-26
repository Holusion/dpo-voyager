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

import download from "@ff/browser/download";
import { downloadZip } from "client-zip";

import Component, { Node, types } from "@ff/graph/Component";

import Notification from "@ff/ui/Notification";

import CVAssetManager from "./CVAssetManager";
import CVAssetWriter from "./CVAssetWriter";
import CVTaskProvider from "./CVTaskProvider";
import CVDocumentProvider from "./CVDocumentProvider";
import { INodeComponents } from "./CVDocument";

import { ETaskMode } from "../applications/taskSets";

import CVMediaManager from "./CVMediaManager";
import CVMeta from "./CVMeta";
import CVStandaloneFileManager from "./CVStandaloneFileManager";

////////////////////////////////////////////////////////////////////////////////


export default class CVStoryApplication extends Component
{
    static readonly typeName: string = "CVStoryApplication";
    static readonly isSystemSingleton = true;

    protected static readonly ins = {
        exit: types.Event("Application.Exit"),
        save: types.Event("Document.Save"),
        download: types.Event("Document.Download"),
    };

    ins = this.addInputs(CVStoryApplication.ins);

    referrer: string = "";
    dragdrop: boolean = false;

    protected get taskProvider() {
        return this.getMainComponent(CVTaskProvider);
    }
    protected get documentProvider() {
        return this.getMainComponent(CVDocumentProvider);
    }
    protected get assetManager() {
        return this.getMainComponent(CVAssetManager);
    }
    protected get assetWriter() {
        return this.getMainComponent(CVAssetWriter);
    }
    protected get mediaManager() {
        return this.system.getMainComponent(CVMediaManager);
    }
    protected get meta() {
        return this.system.getComponent(CVMeta);
    }
    protected get standaloneFileManager() {
        return this.system.getComponent(CVStandaloneFileManager, true);
    }

    constructor(node: Node, id: string)
    {
        super(node, id);
        this.beforeUnload = this.beforeUnload.bind(this);
    }

    create()
    {
        super.create();
        window.addEventListener("beforeunload", this.beforeUnload);
    }

    dispose()
    {
        window.removeEventListener("beforeunload", this.beforeUnload);
        super.dispose();
    }

    update()
    {
        const ins = this.ins;

        if (ins.exit.changed && this.referrer) {
            location.assign(this.referrer);
        }

        const cvDocument = this.documentProvider.activeComponent;

        if (cvDocument) {
            if (ins.save.changed) {
                this.saveDocument()
                .then(() => {
                    if (this.taskProvider.ins.mode.getValidatedValue() !== ETaskMode.Standalone) {
                        new Notification(`Successfully uploaded file to '${cvDocument.assetPath}'`, "info", 4000);
                    }
                })
                .catch(e => new Notification(`Failed to upload file to '${cvDocument.assetPath}'`, "error", 8000));
            }

            if (ins.download.changed) {
                const data = cvDocument.deflateDocument(this.getSavedComponents());
                const json = JSON.stringify(data, null, 2);

                const fileName = this.assetManager.getAssetName(cvDocument.assetPath);
                download.json(json, fileName);
            }
        }


        return false;
    }

    /**
     * Saves the active document, or downloads the scene package in standalone mode.
     * Rejects if the document could not be saved.
     */
    async saveDocument(): Promise<void>
    {
        const cvDocument = this.documentProvider.activeComponent;
        if (!cvDocument) {
            throw new Error("no active document");
        }

        const data = cvDocument.deflateDocument(this.getSavedComponents());
        const json = JSON.stringify(data, (key, value) =>
            typeof value === "number" ? parseFloat(value.toFixed(7)) : value);

        if (this.taskProvider.ins.mode.getValidatedValue() !== ETaskMode.Standalone) {
            return this.assetWriter.putJSON(json, cvDocument.assetPath);
        }

        // Standalone save
        const fileManager : CVStandaloneFileManager = this.standaloneFileManager;
        const saveFiles = [];

        const fileName = this.assetManager.getAssetName(cvDocument.assetPath);
        saveFiles.push({ name: fileName, lastModified: new Date(), input: json });

        const files = fileManager.getFiles().filter(file => file != null && !file.name.endsWith(".json"));
        files.forEach(file => {
            saveFiles.push({ name: fileManager.getFilePath(file.name)+file.name, lastModified: new Date(), input: file });
        });

        const blob = await downloadZip(saveFiles).blob();
        download.url(URL.createObjectURL(blob), "voyager-scene.zip");
    }

    // QC mode saves the model only.
    protected getSavedComponents(): INodeComponents
    {
        if (this.taskProvider.ins.mode.getValidatedValue() !== ETaskMode.QC) {
            return null;
        }
        Notification.show("Running in QC Mode: Saving model only, but no scene data.", "warning", 5000);
        return { model: true };
    }

    /**
     * Provoke a user prompt before unloading the page
     * @param event
     */
    protected beforeUnload(event)
    {
        event.returnValue = "x";
        //return "x";
    }
}