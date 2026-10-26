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
import { HTTPError } from "../utils/errors";

import CVMediaManager from "./CVMediaManager";
import CVMeta from "./CVMeta";
import CVStandaloneFileManager from "./CVStandaloneFileManager";

////////////////////////////////////////////////////////////////////////////////

/**
 * Where the last save stands. Saved means the server confirmed every write, Failed that the scene is known not to
 * be saved, and Unconfirmed that its upload started but no answer came: it may or may not be stored.
 */
export enum ESaveState { Idle, Saving, Saved, Failed, Unconfirmed }

export interface ISaveContext
{
    /** Aborts when the save is cancelled; every step checks it. */
    readonly signal: AbortSignal;
    /** Set when the document's upload starts: from then on, an interrupted save may still have been stored. */
    documentSent: boolean;
}

/** A save to run with [[CVStoryApplication.save]]; resolves with the confirmation to show. */
export type SaveOperation = (context: ISaveContext) => Promise<string>;

const _abortError = () => new DOMException("The save was cancelled.", "AbortError");

/** Settles like promise, or rejects as soon as signal aborts: for a step that can't be interrupted. */
function _untilAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T>
{
    if (!signal) {
        return promise;
    }
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(_abortError());
        if (signal.aborted) {
            return onAbort();
        }
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    });
}

export default class CVStoryApplication extends Component
{
    static readonly typeName: string = "CVStoryApplication";
    static readonly isSystemSingleton = true;

    protected static readonly ins = {
        exit: types.Event("Application.Exit"),
        save: types.Event("Document.Save"),
        download: types.Event("Document.Download"),
    };

    protected static readonly outs = {
        saveState: types.Enum("Document.SaveState", ESaveState, ESaveState.Idle),
    };

    ins = this.addInputs(CVStoryApplication.ins);
    outs = this.addOutputs(CVStoryApplication.outs);

    /** How long the outcome stays on the Save button. */
    static saveResultDuration = { [ESaveState.Saved]: 1500, [ESaveState.Failed]: 3000, [ESaveState.Unconfirmed]: 3000 };

    private _saveAbort: AbortController = null;
    private _saveResultTimer = 0;

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
                this.save();
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

    get isStandalone() {
        return this.taskProvider.ins.mode.getValidatedValue() === ETaskMode.Standalone;
    }

    /** Whether the running save has been cancelled and is winding down. */
    get isCancellingSave() {
        return !!this._saveAbort?.signal.aborted;
    }

    /**
     * Runs a save, the document's by default, and reports its outcome. While it runs, saveState is Saving and the
     * interface is held; it can be cancelled with [[cancelSave]]. Only one save runs at a time: a save requested
     * meanwhile doesn't run, and resolves with null.
     * @returns The confirmation shown if the save succeeded, null otherwise.
     */
    async save(operation: SaveOperation = context => this.saveDocumentOperation(context)): Promise<Notification>
    {
        if (this.outs.saveState.value === ESaveState.Saving) {
            console.warn("CVStoryApplication.save - a save is already running");
            return null;
        }
        window.clearTimeout(this._saveResultTimer);

        // Every step checks the signal, so cancelling ends the operation.
        const abort = this._saveAbort = new AbortController();
        const context: ISaveContext = { signal: abort.signal, documentSent: false };
        this.outs.saveState.setValue(ESaveState.Saving);

        let message: string = null;
        let error: unknown = null;
        try {
            message = await operation(context);
        }
        catch (e) {
            error = e;
        }
        // The outcome is settled: a late cancel can't change it.
        this._saveAbort = null;

        // The state follows the outcome alone, and is set even if reporting fails, so the interface is never left held.
        let state = error ? ESaveState.Failed : ESaveState.Saved;
        let notification: Notification = null;
        try {
            if (error) {
                state = this.reportSaveError(error, context);
            }
            else {
                notification = new Notification(message, "success", 4000);
            }
        }
        finally {
            this.outs.saveState.setValue(state);
            this._saveResultTimer = window.setTimeout(() => this.outs.saveState.setValue(ESaveState.Idle),
                CVStoryApplication.saveResultDuration[state]);
        }
        return notification;
    }

    /** Cancels the running save. Whatever was confirmed before stays saved. */
    cancelSave()
    {
        this._saveAbort?.abort();
    }

    protected async saveDocumentOperation(context: ISaveContext): Promise<string>
    {
        await this.saveDocument(context);
        const path = this.documentProvider.activeComponent.assetPath;
        return this.isStandalone ? "Scene package handed to your browser for download." :
            this.taskProvider.ins.mode.getValidatedValue() === ETaskMode.QC ? `Model saved to '${path}'.` :
            `Scene saved to '${path}'.`;
    }

    /** Reports why a save didn't succeed, and returns the save state it leaves. */
    protected reportSaveError(error: any, context: ISaveContext): ESaveState
    {
        const what = this.isStandalone ? "Scene NOT downloaded" : "Scene NOT saved";

        if (error?.name === "AbortError" || error?.name === "NetworkError") {
            if (context.documentSent) {
                const why = error.name === "NetworkError" ?
                    "the connection to the server failed during the upload" : "the save was cancelled during the upload";
                new Notification(`Save NOT confirmed: ${why}, so the scene may or may not be stored.`, "warning", 0);
                return ESaveState.Unconfirmed;
            }
            new Notification(error.name === "NetworkError" ?
                `${what}: the server could not be reached. Check your connection, then save again.` :
                `${what}: the save was cancelled.`, "error", 0);
            return ESaveState.Failed;
        }

        if (error instanceof HTTPError) {
            const file = this.getFileName(error.url);
            const status = error.status;
            const why =
                status === 401 || status === 403 ? `you are not allowed to write '${file}' (your session may have expired)` :
                status === 404 || status === 409 ? `the folder of '${file}' was not found on the server` :
                status === 413 ? `'${file}' is too large for the server` :
                status === 423 ? `'${file}' is locked on the server` :
                status === 507 ? "the server is out of storage space" :
                status >= 500 ? `the server failed to store '${file}' (error ${status})` :
                `the server refused '${file}' (error ${status}: ${error.detail})`;
            new Notification(`${what}: ${why}.`, "error", 0);
            return ESaveState.Failed;
        }

        console.error("CVStoryApplication.save - unexpected error", error);
        new Notification(`${what}: unexpected error (${error?.message ?? error}); details are in the browser console.`, "error", 0);
        return ESaveState.Failed;
    }

    protected getFileName(url: string)
    {
        const name = this.assetManager.getAssetName(url.split(/[?#]/)[0]);
        try {
            return decodeURIComponent(name);
        }
        catch {
            return name;
        }
    }

    /**
     * Saves the active document, or downloads the scene package in standalone mode.
     * Rejects if the document could not be saved.
     */
    async saveDocument(context?: ISaveContext): Promise<void>
    {
        const cvDocument = this.documentProvider.activeComponent;
        if (!cvDocument) {
            throw new Error("no active document");
        }

        const data = cvDocument.deflateDocument(this.getSavedComponents());
        const json = JSON.stringify(data, (key, value) =>
            typeof value === "number" ? parseFloat(value.toFixed(7)) : value);

        const signal = context?.signal;
        if (signal?.aborted) {
            throw _abortError();
        }

        if (!this.isStandalone) {
            if (context) {
                context.documentSent = true;
            }
            return this.assetWriter.putJSON(json, cvDocument.assetPath, {signal});
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

        // Zipping can't be interrupted: a cancel stops the wait instead, and nothing is downloaded.
        const blob = await _untilAborted(downloadZip(saveFiles).blob(), signal);
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