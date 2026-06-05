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


import TypeRegistry from "@ff/core/TypeRegistry";

import System from "@ff/graph/System";

import coreTypes from "./coreTypes";
import miniTypes from "./miniTypes";

import * as documentTemplate from "client/templates/default.svx.json";

import CVDocumentProvider from "../components/CVDocumentProvider";
import CVDocument from "../components/CVDocument";
import CVAssetManager from "../components/CVAssetManager";
import CVAssetReader from "../components/CVAssetReader";

import NVEngine from "../nodes/NVEngine";
import NVDocuments from "../nodes/NVDocuments";

import MainView from "../ui/mini/MainView";
import { EDerivativeQuality } from "client/schema/model";
import { EReaderPosition } from "client/schema/setup";

////////////////////////////////////////////////////////////////////////////////

export interface IMiniApplicationProps
{
    /** URL of the root asset folder. */
    root?: string;
    /** URL of the document to load and display at startup. */
    document?: string;
    /** URL of a model (supported formats: gltf, glb) to load and display at startup. */
    model?: string;
    /** URL of a geometry (supported formats: obj, ply) to load and display at startup. */
    geometry?: string;
    /** If a geometry URL is given, optional URL of a color texture to use with the geometry. */
    texture?: string;
    /** When loading a model or geometry, the quality level to set for the asset.
     Valid options: "thumb", "low", "medium", "high". */
    quality?: string;
}

export default class MiniApplication
{
    protected static splashMessage = [
        "Voyager - 3D Explorer and Tool Suite",
        "3D Foundation Project",
        "(c) 2025 Smithsonian Institution",
        "https://3d.si.edu"
    ].join("\n");

    readonly props: IMiniApplicationProps;
    readonly system: System;

    protected get assetManager() {
        return this.system.getMainComponent(CVAssetManager);
    }
    protected get assetReader() {
        return this.system.getMainComponent(CVAssetReader);
    }
    protected get documentProvider() {
        return this.system.getMainComponent(CVDocumentProvider);
    }

    constructor(parent?: HTMLElement, props?: IMiniApplicationProps)
    {
        this.props = props;
        console.log(MiniApplication.splashMessage);

        // register components
        const registry = new TypeRegistry();

        registry.add(coreTypes);
        registry.add(miniTypes);

        const system = this.system = new System(registry);

        const engine = system.graph.createCustomNode(NVEngine);
        system.graph.createCustomNode(NVDocuments);

        if (parent) {
            // create a view and attach to parent
            new MainView(this).appendTo(parent);
        }

        // create the single, persistent document up front (empty), then load
        this.documentProvider.ensureDocument();
        this.evaluateProps();

        //*** Support message passing over channel 2 ***//
        {
            // Add listener for the intial port transfer message
            var port2;
            window.addEventListener('message', initPort);

            // Setup port for message passing
            function initPort(e) {
                port2 = e.ports[0];
                port2.onmessage = onMessage;
            }

            // Handle messages received on port2
            function onMessage(e) {
                if (ENV_DEVELOPMENT) {
                    console.log('Message received by VoyagerMini: "' + e.data + '"');
                }

                if (e.data === "Toggle Annotations") {
                    const viewerIns = system.getMainComponent(CVDocumentProvider).activeComponent.setup.viewer.ins;
                    viewerIns.annotationsVisible.setValue(!viewerIns.annotationsVisible.value);
                }
            }
        }

        // start rendering
        engine.pulse.start();
    }

    setBaseUrl(url: string)
    {
        this.assetManager.baseUrl = url;
    }

    loadDocument(documentPath: string, quality?: string): Promise<CVDocument>
    {
        const dq = EDerivativeQuality[quality];
        this.documentProvider.setLoading();

        return this.assetReader.getJSON(documentPath)
        .then(data => {
            // repopulate the persistent document in place
            const document = this.documentProvider.openDocument(data, documentPath);
            if (isFinite(dq)) {
                document.setup.viewer.ins.quality.setValue(dq);
            }
            this.documentProvider.setReady();
            return document;
        })
        .catch(error => {
            this.documentProvider.setError();
            console.warn(`error while loading document: ${error.message}`);
            throw error;
        });
    }

    loadModel(modelPath: string, quality: string)
    {
        this.documentProvider.setLoading();
        this.documentProvider.openDocument(documentTemplate as any);
        const document = this.documentProvider.appendModel(modelPath, quality);
        this.documentProvider.setReady();
        return document;
    }

    loadGeometry(geoPath: string, colorMapPath?: string,
                 occlusionMapPath?: string, normalMapPath?: string, quality?: string)
    {
        this.documentProvider.setLoading();
        this.documentProvider.openDocument(documentTemplate as any);
        const document = this.documentProvider.appendGeometry(
            geoPath, colorMapPath, occlusionMapPath, normalMapPath, quality);
        this.documentProvider.setReady();
        return document;
    }

    evaluateProps()
    {
        const props = {...this.props};
        const manager = this.assetManager;

        const qs = new URL(window.location.href).searchParams;
        props.root = props.root || qs.get("root") || qs.get("r");
        props.document = props.document || qs.get("document") || qs.get("d");
        props.model = props.model || qs.get("model") || qs.get("m");
        props.geometry = props.geometry || qs.get("geometry") || qs.get("g");
        props.texture = props.texture || qs.get("texture") || qs.get("t");
        props.quality = props.quality || qs.get("quality") || qs.get("q");

        const url = props.root || props.document || props.model || props.geometry;
        this.setBaseUrl(new URL(url || ".", window.location as any).href);

        if (props.document) {
            props.document = props.root ? props.document : manager.getAssetName(props.document);
            this.loadDocument(props.document, props.quality);
        }
        else if (props.model) {
            props.model = props.root ? props.model : manager.getAssetName(props.model);
            this.loadModel(props.model, props.quality);
        }
        else if (props.geometry) {
            props.geometry = props.root ? props.geometry : manager.getAssetName(props.geometry);
            props.texture = props.root ? props.texture : manager.getAssetName(props.texture);
            this.loadGeometry(props.geometry, props.texture, null, null, props.quality);
        }
        else {
            // if nothing else specified, try to read "document.svx.json" from the current folder
            this.loadDocument("document.svx.json").catch(() => {});
        }
    }
}

window["VoyagerMini"] = MiniApplication;