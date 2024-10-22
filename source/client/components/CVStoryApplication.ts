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

import download from "@ff/browser/download";
import { downloadZip } from "client-zip";

import Component, { ITypedEvent, Node, types } from "@ff/graph/Component";

import Notification from "@ff/ui/Notification";

import CVAssetManager from "./CVAssetManager";
import CVAssetWriter from "./CVAssetWriter";
import CVTaskProvider from "./CVTaskProvider";
import CVDocumentProvider from "./CVDocumentProvider";
import CVDocument, { INodeComponents } from "./CVDocument";

import { ETaskMode } from "../applications/taskSets";

import CVMediaManager from "./CVMediaManager";
import CVMeta from "./CVMeta";
import CVStandaloneFileManager from "./CVStandaloneFileManager";

////////////////////////////////////////////////////////////////////////////////

function _arrayBufferToBase64( buffer:ArrayBuffer ) {
    var binary = '';
    var bytes = new Uint8Array(buffer);
    var len = bytes.byteLength;
    for (var i = 0; i < len; i++) {
        binary += String.fromCharCode( bytes[ i ] );
    }
    return window.btoa( binary );
}

export default class CVStoryApplication extends Component
{
    static readonly typeName: string = "CVStoryApplication";
    static readonly isSystemSingleton = true;

    private _last_hash ?:ArrayBuffer = null ;
    private _last_str ?:string = null;

    protected static readonly ins = {
        exit: types.Event("Application.Exit"),
        save: types.Event("Document.Save"),
        download: types.Event("Document.Download"),
    };

    ins = this.addInputs(CVStoryApplication.ins);

    referrer: string = "";

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
        this.documentProvider.outs.activeDocument.on("value", this.onDocument, this);
        //*
        setTimeout(()=>{
            let current_str = this.deflate(this.documentProvider.activeComponent);
            let prev_lines = this._last_str.split("\n");
            let lines = current_str.split("\n");
            if(prev_lines.length != lines.length) console.warn("Differing lengths : %d, %d", prev_lines.length, lines.length)
            for(let n =0; n < lines.length; n++){
                if(lines[n] != prev_lines[n]){
                    console.log("Different lines : (%d)", n);
                    console.log("Prev :")
                    console.log(prev_lines.slice(Math.max(0, n-4),Math.min(prev_lines.length,n+10)).join("\n"))
                    console.log("Current :")
                    console.log(lines.slice(Math.max(0, n-4),Math.min(lines.length,n+10)).join("\n"))
                    break;
                }
            }
        }, 1000); //*/
    }

    dispose()
    {
        window.removeEventListener("beforeunload", this.beforeUnload);
        this.documentProvider.outs.activeDocument.off("value", this.onDocument, this);
        super.dispose();
    }

    private onDocument(doc :CVDocument){
        console.debug("onDocument", doc);
        doc.outs.assetPath.on("value", ()=>{
            (async ()=>{
                this._last_str = this.deflate(this.documentProvider.activeComponent);
                this._last_hash = await this.hash();
            })();

        })
    }

    private deflate(document :CVDocument):string{
        const storyMode = this.taskProvider.ins.mode.getValidatedValue();
        const components: INodeComponents = (storyMode === ETaskMode.QC ? { model: true } : null);
        const data = document.deflateDocument(components);
        return JSON.stringify(data, (key, value) =>
            typeof value === "number" ? parseFloat(value.toFixed(7)) : value, 2);
    }

    private async hash() :Promise<ArrayBuffer|null>{
        const json = this.deflate(this.documentProvider.activeComponent);
        const encoder = new TextEncoder();
        const uint8Array = encoder.encode(json);
        return await window.crypto.subtle?.digest("SHA-1", uint8Array) ?? null;
    }

    private async isChanged() :Promise<boolean>{
        let decoder = new TextDecoder();
        const current_hash = await this.hash();
        console.log("Hashes :", _arrayBufferToBase64(this._last_hash),_arrayBufferToBase64(current_hash) );
        if(!this._last_hash || !current_hash) return true;
        for(let idx =0; idx < this._last_hash.byteLength; idx++){
            if(this._last_hash[idx] != current_hash[idx]) return true;
        }
        return false;
    }

    update()
    {
        const ins = this.ins;

        if (ins.exit.changed && this.referrer) {
            location.assign(this.referrer);
        }

        const cvDocument = this.documentProvider.activeComponent;

        if (cvDocument) {
            // in QC mode, only save the model, but no scene data, in all other modes, save everything
            const storyMode = this.taskProvider.ins.mode.getValidatedValue();
            const components: INodeComponents = storyMode === ETaskMode.QC ? { model: true } : null;

            if (ins.save.changed) {
                const json = this.deflate(cvDocument);

                if(storyMode !== ETaskMode.Standalone) {
                    this.assetWriter.putJSON(json, cvDocument.assetPath)
                    .then(() => new Notification(`Successfully uploaded file to '${cvDocument.assetPath}'`, "info", 4000))
                    .catch(e => new Notification(`Failed to upload file to '${cvDocument.assetPath}'`, "error", 8000));
                }
                else {
                    // Standalone save
                    const fileManager : CVStandaloneFileManager = this.standaloneFileManager;
                    const saveFiles = [];

                    const fileName = this.assetManager.getAssetName(cvDocument.assetPath);
                    saveFiles.push({ name: fileName, lastModified: new Date(), input: json });

                    const files = fileManager.getFiles().filter(file => file != null && !file.name.endsWith(".json"));
                    files.forEach(file => {
                        saveFiles.push({ name: fileManager.getFilePath(file.name)+file.name, lastModified: new Date(), input: file });
                    });
               
                    downloadZip(saveFiles).blob().then(blob => { // await for async
                        const bloburl = URL.createObjectURL(blob);
                        download.url(bloburl, "voyager-scene.zip");
                    });
                }
            }

            if (ins.download.changed) {
                const json = this.deflate(cvDocument);

                const fileName = this.assetManager.getAssetName(cvDocument.assetPath);
                download.json(json, fileName);
            }
        }


        return false;
    }

    /**
     * Provoke a user prompt before unloading the page
     * @param event
     */
    protected async beforeUnload(event)
    {
        if(await this.isChanged()){
            event.returnValue = "x";
        }
        //return "x";
    }
}