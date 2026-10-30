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

import Component, { types } from "@ff/graph/Component";
import Property from "@ff/graph/Property";
import CTransform from "@ff/scene/components/CTransform";

import { IDocument } from "client/schema/document";
import { ISetup } from "client/schema/setup";
import { getPersistedProperties, serializeInputs } from "client/utils/persist";

import CVInterface from "./CVInterface";
import CVViewer from "./CVViewer";
import CVReader from "./CVReader";
import CVOrbitNavigation from "./CVOrbitNavigation";
import CVBackground from "./CVBackground";
import CVFloor from "./CVFloor";
import CVGrid from "./CVGrid";
import CVTape from "./CVTape";
import CVSlicer from "./CVSlicer";
import CVTours from "./CVTours";
import CVSnapshots from "./CVSnapshots";
import CVEnvironment from "./CVEnvironment";
import CVLanguageManager from "./CVLanguageManager";
import CVAudioManager from "./CVAudioManager";
import CVDerivativesController from "./CVDerivativesController";
import CVActionManager from "./CVActionManager";

////////////////////////////////////////////////////////////////////////////////

/**
 * At the root of a Voyager scene, this component manages scene features,
 * including tours.
 */
export default class CVSetup extends Component
{
    static readonly typeName: string = "CVSetup";

    // Setup data as loaded, kept so unknown sections survive a save.
    private _loadedSetupData: ISetup = {};
    // Values of "capture" properties at the last capture.
    private _capturedValues = new Map<Property, any>();
    // Original values of properties temporarily overridden, e.g. by story tasks.
    private _overriddenValues = new Map<Property, any>();

    protected static readonly ins = {
        saveState: types.Event("Setup.SaveState"),
        restoreState: types.Event("Setup.RestoreState"),
    };

    ins = this.addInputs(CVSetup.ins);

    protected static readonly featureMap = {
        "interface": CVInterface,
        "reader": CVReader,
        "viewer": CVViewer,
        "navigation": CVOrbitNavigation,
        "derivatives": CVDerivativesController, 
        "background": CVBackground,
        "environment": CVEnvironment,
        "language": CVLanguageManager,
        "floor": CVFloor,
        "grid": CVGrid,
        "tape": CVTape,
        "slicer": CVSlicer,
        "tours": CVTours,
        "audio": CVAudioManager,
        "actions": CVActionManager
    };

    get featureMap() {
        return (this.constructor as typeof CVSetup).featureMap;
    }
    get transform() {
        return this.getComponent(CTransform);
    }

    interface: CVInterface;
    reader: CVReader;
    viewer: CVViewer;
    navigation: CVOrbitNavigation;
    derivatives: CVDerivativesController;
    background: CVBackground;
    floor: CVFloor;
    grid: CVGrid;
    tape: CVTape;
    slicer: CVSlicer;
    tours: CVTours;
    snapshots: CVSnapshots;
    environment: CVEnvironment;
    language: CVLanguageManager;
    audio: CVAudioManager;
    actions: CVActionManager;

    create()
    {
        super.create();

        const node = this.node;
        const features = CVSetup.featureMap;

        for (const name in features) {
            this[name] = node.createComponent(features[name]);
        }

        this.snapshots = node.createComponent(CVSnapshots);
    }

    dispose()
    {
        this._loadedSetupData = null;
        this._capturedValues.clear();
        this._overriddenValues.clear();

        const features = CVSetup.featureMap;
        for (const name in features) {
            this[name] = null;
        }
        this.snapshots = null;

        super.dispose();
    }

    update()
    {
        const ins = this.ins;

        if (ins.saveState.changed) {
            this.cacheSetupState();
        }
        if (ins.restoreState.changed) {
            this.restoreSetupState();
        }
        
        return true;
    }

    fromDocument(document: IDocument, sceneIndex: number, pathMap: Map<string, Component>)
    {
        const scene = document.scenes[sceneIndex];

        const setupData = document.setups?.[scene.setup] ?? {};
        this._loadedSetupData = JSON.parse(JSON.stringify(setupData));
        const features = CVSetup.featureMap;

        for (const name in features) {
            pathMap.set(`scenes/${sceneIndex}/setup/${name}`, this[name]);

            const featureData = setupData[name];
            if (featureData) {
                this[name].fromData(featureData);
            }
            else {
                this[name].ins.properties.forEach((prop) => prop.changed = !prop.schema.event);
            }
        }

        this.cacheSetupState();
    }

    toDocument(document: IDocument, sceneIndex: number, pathMap: Map<Component, string>)
    {
        const setupData: ISetup = { ...this._loadedSetupData };
        const features = CVSetup.featureMap;

        // captured values take precedence over overridden ones, which take precedence over live ones
        const values = new Map([ ...this._overriddenValues, ...this._capturedValues ]);

        for (const name in features) {
            const component = this[name];
            pathMap.set(component, `scenes/${sceneIndex}/setup/${name}`);

            const featureData = component.toData(serializeInputs(component, values));
            if (featureData) {
                setupData[name] = featureData;
            }
            else {
                delete setupData[name];
            }
        }

        const snapshotData = this.snapshots.toData(pathMap);
        if (snapshotData) {
            setupData.snapshots = snapshotData;
        }

        document.setups = document.setups || [];
        const index = document.setups.length;
        document.setups.push(setupData);
        document.scenes[sceneIndex].setup = index;
    }

    /**
     * Temporarily sets a property value. The original value is the one that gets
     * captured and saved, until it is restored with [[restoreValue]].
     */
    overrideValue(property: Property, value: any)
    {
        if (!this._overriddenValues.has(property)) {
            this._overriddenValues.set(property, property.cloneValue());
        }
        property.setValue(value);
    }

    restoreValue(property: Property)
    {
        if (this._overriddenValues.has(property)) {
            property.setValue(this._overriddenValues.get(property));
            this._overriddenValues.delete(property);
        }
    }

    // Caches the current value of "capture" properties for future saving.
    protected cacheSetupState()
    {
        const features = CVSetup.featureMap;
        this._capturedValues.clear();

        for (const name in features) {
            getPersistedProperties(this[name], "capture").forEach(property => {
                const value = this._overriddenValues.has(property) ? this._overriddenValues.get(property) : property.value;
                this._capturedValues.set(property, Array.isArray(value) ? value.slice() : value);
            });
        }

        this.language.ins.primarySceneLanguage.setValue(this.language.ins.activeLanguage.value);
    }

    // Restores the cached value of "capture" properties.
    protected restoreSetupState()
    {
        this._capturedValues.forEach((value, property) => {
            value = Array.isArray(value) ? value.slice() : value;
            if (this._overriddenValues.has(property)) {
                this._overriddenValues.set(property, value);
            }
            else {
                property.setValue(value);
            }
        });

        this.slicer.ins.enabled.set();  // slicer needs a push to refresh
        if(this.navigation.ins.autoZoom.value) {
            this.navigation.ins.zoomExtents.set();
        }
    }

    resetViewer() {
        this.actions.ins.reset.set();
        this.audio.ins.reset.set();
        this.navigation.ins.projection.reset();  // projection not currently included in scene state
        this.ins.restoreState.set();
    }
}