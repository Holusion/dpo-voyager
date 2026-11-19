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

import { TDerivativeQuality } from "client/schema/model";

////////////////////////////////////////////////////////////////////////////////

/**
 * Progress of a model upload, as shown in the import menu.
 * Voyager owns the wording: the uploader only reports which phase it is in.
 */
export interface IModelUploadProgress
{
    /** "upload": sending the file. "process": waiting for the server to make the model */
    phase: "upload" | "process";
    /** Bytes sent so far. With `total`, shows a progress bar */
    loaded?: number;
    /** Total bytes to send */
    total?: number;
}

export interface IModelUploadRequest
{
    file: File;
    /** Quality chosen in the import menu, before anything is sent */
    quality: TDerivativeQuality;
    /** Where Voyager would put the file, relative to the scene's root */
    path: string;
    /** Aborted when the import menu is closed */
    signal: AbortSignal;
    onProgress(progress: IModelUploadProgress): void;
}

export interface IModelUploadResult
{
    /** The model to load, relative to the scene's root. It may differ from the request's path */
    uri: string;
}

/**
 * Sends model files dropped in Voyager Story to the server.
 *
 * Set one as `modelUploader` on the `<voyager-story>` element to let the server handle
 * the files: typically to convert other formats (obj, ply, stl...) to glb, optimize them,
 * and choose where they are stored.
 *
 * When none is set, files are written as-is to the scene's root (a WebDAV PUT).
 */
export interface IModelUploader
{
    /**
     * Extensions this uploader accepts, on top of "glb". Example: ["obj", "ply", "stl"]
     */
    accept?: string[];
    /**
     * Resolves once the model can be loaded from the returned uri.
     * Rejects with an Error whose message is shown in the import menu.
     */
    upload(request: IModelUploadRequest): Promise<IModelUploadResult>;
}
