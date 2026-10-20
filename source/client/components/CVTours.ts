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
import { IDeltaState } from "@ff/graph/components/CTweenMachine";
import { IPulseContext } from "@ff/graph/components/CPulse";
import Document from "@ff/core/Document";

import { ITour, ITours, ITourStep } from "client/schema/setup";
import { ELanguageType, DEFAULT_LANGUAGE } from "client/schema/common";
import { EActionTrigger, EActionType, EActionPlayStyle, IAction, TActionTrigger, TActionType, TActionPlayStyle } from "client/schema/meta";
import { composeStep, IPathValues, sparsifySteps, touchedPaths, ValueMap } from "client/utils/tourSteps";

import CVSnapshots, { EEasingCurve } from "./CVSnapshots";
import CVAnalytics from "./CVAnalytics";
import CVLanguageManager from "./CVLanguageManager";
import CVSetup from "./CVSetup";
import CVMeta from "./CVMeta";

////////////////////////////////////////////////////////////////////////////////

export default class CVTours extends Component
{
    static readonly typeName: string = "CVTours";
    static readonly sceneSnapshotId = "scene-default";
    /** Transient delta state holding the composed values of the step being played. */
    static readonly stepStateId = "tour-step";

    static isTransientState(id: string) {
        return id === CVTours.sceneSnapshotId || id === CVTours.stepStateId;
    }

    protected static readonly ins = {
        enabled: types.Boolean("Tours.Enabled"),
        tourIndex: types.Integer("Tours.Index", -1),
        closed: types.Event("Tours.Closed"),
        stepIndex: types.Integer("Step.Index"),
        next: types.Event("Step.Next"),
        previous: types.Event("Step.Previous"),
        first: types.Event("Step.First"),
    };

    protected static readonly outs = {
        count: types.Integer("Tours.Count"),
        tourIndex: types.Integer("Tour.Index", -1),
        tourTitle: types.String("Tour.Title"),
        tourLead: types.String("Tour.Lead"),
        stepCount: types.Integer("Tour.Steps"),
        ending: types.Boolean("Tour.Ending"),
        stepIndex: types.Integer("Step.Index"),
        stepTitle: types.String("Step.Title"),
    };

    ins = this.addInputs(CVTours.ins);
    outs = this.addOutputs(CVTours.outs);

    private _tours: ITour[] = [];
    /** Recordable values when tours were enabled: what steps are composed on, and restored on exit. */
    private _base: ValueMap = null;

    protected get analytics() {
        return this.getMainComponent(CVAnalytics);
    }
    protected get language() {
        return this.getGraphComponent(CVLanguageManager);
    }
    protected get setup() {
        return this.getGraphComponent(CVSetup);
    }

    get snapshots() {
        return this.getComponent(CVSnapshots);
    }
    get tours() {
        return this._tours;
    }
    get activeSteps() {
        const tour = this.activeTour;
        return tour ? tour.steps : null;
    }
    get activeTour() {
        return this._tours[this.outs.tourIndex.value];
    }
    get activeStep() {
        const tour = this.activeTour;
        return tour ? tour.steps[this.outs.stepIndex.value] : null;
    }

    get title() {
        const tour = this.activeTour;
        // TODO: Temporary - remove when single string properties are phased out
        if(Object.keys(tour.titles).length === 0) {
            tour.titles[DEFAULT_LANGUAGE] = tour.title;
        }

        return tour.titles[ELanguageType[this.language.outs.activeLanguage.value]] || "Missing content";
    }
    set title(inTitle: string) {
        const tour = this.activeTour;
        tour.titles[ELanguageType[this.language.outs.activeLanguage.value]] = inTitle; 
    }
    get lead() {
        const tour = this.activeTour;
        // TODO: Temporary - remove when single string properties are phased out
        if(Object.keys(tour.leads).length === 0) {
            tour.leads[DEFAULT_LANGUAGE] = tour.lead;
        }

        return tour.leads[ELanguageType[this.language.outs.activeLanguage.value]] || "";
    }
    set lead(inLead: string) {
        const tour = this.activeTour;
        tour.leads[ELanguageType[this.language.outs.activeLanguage.value]] = inLead;
    }
    get taglist() {
        const tour = this.activeTour;
        // TODO: Temporary - remove when single string properties are phased out
        if(Object.keys(tour.taglist).length === 0) {
            if(tour.tags.length > 0) {
                tour.taglist[DEFAULT_LANGUAGE] = tour.tags;
            }
        }

        return tour.taglist[ELanguageType[this.language.outs.activeLanguage.value]] || [];
    }
    set taglist(inTags: string[]) {
        const tour = this.activeTour;
        tour.taglist[ELanguageType[this.language.outs.activeLanguage.value]] = inTags;
    }
    get stepTitle() {
        const step = this.activeStep;

        if(step) {
            // TODO: Temporary - remove when single string properties are phased out
            if(Object.keys(step.titles).length === 0) {
                step.titles[DEFAULT_LANGUAGE] = step.title;
            }

            return step.titles[ELanguageType[this.language.outs.activeLanguage.value]] || "Missing content";
        }
        else {
            return null;
        }
    }
    set stepTitle(inTitle: string) {
        const step = this.activeStep;
        if(step) {
            step.titles[ELanguageType[this.language.outs.activeLanguage.value]] = inTitle;
        }
    }
    get stepAltText() {
        const step = this.activeStep;

        if(step) {
            return step.altTexts[ELanguageType[this.language.outs.activeLanguage.value]] || "Missing content";
        }
        else {
            return null;
        }
    }
    set stepAltText(inText: string) {
        const step = this.activeStep;
        if(step) {
            step.altTexts[ELanguageType[this.language.outs.activeLanguage.value]] = inText;
        }
    }

    create()
    {
        super.create();
        this.language.outs.activeLanguage.on("value", this.update, this);
    }

    dispose()
    {
        this.language.outs.activeLanguage.off("value", this.update, this);
        super.dispose();
    }

    update(context: IPulseContext)
    {
        const { ins, outs } = this;

        const tours = this._tours;
        const navigation = this.setup.navigation;
        const srElement = this.setup.viewer.rootElement.shadowRoot.querySelector("#sceneview-sr");

        if (ins.enabled.changed) {

            if (ins.enabled.value) {
                this.setup.navigation.ins.isInUse.setValue(true); // count tour as interaction
                this.snapshots.endTween();

                // store pre-tour scene state
                this._base = this.captureBase();
            }
            else {
                outs.tourIndex.set();

                // recall pre-tour scene state for everything the tours may have changed
                if (this._base) {
                    const paths = touchedPaths([].concat(...tours.map(tour => this.getTourStates(tour))));
                    this.playValues(this._base, paths, { curve: EEasingCurve.EaseOutQuad, duration: 1, threshold: 0 }, true);
                    this._base = null;
                }

                srElement.textContent = "";

                return true;
            }
        }

        const tourIndex = Math.min(tours.length - 1, Math.max(-1, ins.tourIndex.value));
        const tour = tours[tourIndex];
        const stepCount = tour ? tour.steps.length : 0;
        outs.stepCount.setValue(stepCount);

        let nextStepIndex = -1;

        if (ins.tourIndex.changed || ins.enabled.changed) {
            if (tourIndex !== outs.tourIndex.value) {
                nextStepIndex = 0;
            }

            outs.tourIndex.setValue(tourIndex);
            outs.tourTitle.setValue(tour ? this.title : "");
            outs.tourLead.setValue(tour ? this.lead : "");
        }

        if (stepCount === 0) {
            outs.stepIndex.setValue(-1);
            outs.stepTitle.setValue("");
            return true;
        }

        let tween = true;

        if (ins.enabled.changed) {
            nextStepIndex = outs.stepIndex.value;
        }
        if (ins.stepIndex.changed) {
            nextStepIndex = Math.min(tour.steps.length - 1, Math.max(0, ins.stepIndex.value));
            tween = false;
        }
        if (ins.first.changed) {
            nextStepIndex = 0;
        }
        if (ins.next.changed) {
            nextStepIndex = outs.stepIndex.value + 1;
            // after last step, show tour menu
            if (nextStepIndex >= stepCount) {
                outs.ending.setValue(true);
                outs.tourIndex.setValue(-1);
                outs.tourTitle.setValue("");
                outs.tourLead.setValue("");
                outs.stepIndex.set();
                nextStepIndex = -1;
                srElement.textContent = "";
            }
        }
        if (ins.previous.changed) {
            // previous step, wrap around when reaching first step
            nextStepIndex = (outs.stepIndex.value + stepCount - 1) % stepCount;
        }

        if (nextStepIndex >= 0) {
            navigation.setChanged(true); // disable autoZoom
            outs.stepIndex.setValue(nextStepIndex);
            outs.stepTitle.setValue(this.stepTitle || "Missing content");
            // tween to the next step
            this.playStep(tour, nextStepIndex, tween);
            srElement.textContent = this.stepAltText != "Missing content" ? "Alt text: " + this.stepAltText : "";
        }

        return true;
    }

    fromData(data: ITours)
    {
        this._tours = data.map(tour => ({
            title: tour.title,
            titles: tour.titles || {},
            steps: tour.steps.map(step => ({
                title: step.title,
                titles: step.titles || {},
                altTexts: step.altTexts || {},
                id: step.id,
            })),
            lead: tour.lead || "",
            leads: tour.leads || {},
            tags: tour.tags || [],
            taglist: tour.taglist || {}
        }));

        // update langauges used in tours
        this._tours.forEach( tour => {
            Object.keys(tour.titles).forEach( key => {
                this.language.addLanguage(ELanguageType[key]);
            });

            // TODO: Delete when single string properties are phased out
            tour.steps.forEach( step => {
                if(Object.keys(step.titles).length == 0) {
                    step.titles[DEFAULT_LANGUAGE] = step.title || null;
                }
            });
        });

        this.ins.tourIndex.setValue(-1);
        this.outs.count.setValue(this._tours.length);
    }

    toData(): ITours | null
    {
        if (this._tours.length === 0) {
            return null;
        }

        return  this._tours.map(tour => {
            const data: Partial<ITour> = {
                steps: tour.steps.map(step => {
                    const tourstep: Partial<ITourStep> = {};
                    tourstep.id = step.id;
                    if (Object.keys(step.titles).length > 0) {
                        tourstep.titles = step.titles;
                    }
                    else if (step.title) {
                        tourstep.title = step.title;
                    }

                    if (Object.keys(step.altTexts).length > 0) {
                        tourstep.altTexts = step.altTexts;
                    }

                    return tourstep as ITourStep;
                }),
            };

            if (Object.keys(tour.titles).length > 0) {
                data.titles = tour.titles;
            }
            else if (tour.title) {
                data.title = tour.title;
            }
            if (Object.keys(tour.leads).length > 0) {
                data.leads = tour.leads;
            }
            else if (tour.lead) {
                data.lead = tour.lead;
            }
            if (Object.keys(tour.taglist).length > 0) {
                data.taglist = tour.taglist;
            }
            else if (tour.tags.length > 0) {
                data.tags = tour.tags;
            }

            return data as ITour;
        });
    }

    get base(): ValueMap {
        if (!this._base) {
            this._base = this.captureBase();
        }
        return this._base;
    }

    /** Recordable values, plus whatever else the tours change (e.g. model quality in migrated steps), so exiting restores it. */
    protected captureBase(): ValueMap
    {
        const machine = this.snapshots;
        const base = machine.captureValues();
        const paths = touchedPaths([].concat(...this.tours.map(tour => this.getTourStates(tour))));
        const properties = Array.from(paths).filter(path => !base.has(path)).map(path => machine.getPathProperty(path)).filter(property => property);
        machine.captureValues(properties).forEach((value, path) => base.set(path, value));
        return base;
    }

    /** Actions triggered by entering the given step, from every meta (scene and models). */
    getStepActions(stepId: string): IAction[]
    {
        const actions: IAction[] = [];
        this.getGraphComponents(CVMeta).forEach(meta => meta.actions.items.forEach(action => {
            if (action.trigger === EActionTrigger[EActionTrigger.OnTourStep] as TActionTrigger && action.triggerDetail === stepId) {
                actions.push(action);
            }
        }));
        return actions;
    }

    /** Delta states set by the given step's enabled state change actions, in action order. */
    getStepStates(stepId: string): IDeltaState[]
    {
        return this.getStepActions(stepId)
            .filter(action => action.enabled && action.type === EActionType[EActionType.StateChange] as TActionType)
            .map(action => this.snapshots.getState(action.stateId) as IDeltaState)
            .filter(state => state && "paths" in state);
    }

    getTourStates(tour: ITour): IDeltaState[][]
    {
        return tour.steps.map(step => this.getStepStates(step.id));
    }

    /**
     * Values of the scene at the given step: the pre-tour values, overlaid with the states of steps 0..index.
     * States in `exclude` are left out (used to record a step's own state).
     */
    composeValues(tour: ITour, index: number, exclude: IDeltaState[] = []): ValueMap
    {
        const steps = this.getTourStates(tour).map(states => states.filter(state => exclude.indexOf(state) < 0));
        return composeStep(this.base, steps, index);
    }

    /** Creates a delta state with the given values, linked to the step by a state change action of the scene meta. */
    createStepState(step: ITourStep, values: IPathValues, transition: { curve: EEasingCurve, duration: number, threshold: number }): IDeltaState
    {
        const title = step.titles[DEFAULT_LANGUAGE] || Object.values(step.titles).find(title => !!title) || step.title || "Step";
        const state = this.snapshots.createDeltaState(title, values, transition);

        const action: IAction = {
            id: Document.generateId(),
            name: title,
            type: EActionType[EActionType.StateChange] as TActionType,
            trigger: EActionTrigger[EActionTrigger.OnTourStep] as TActionTrigger,
            triggerDetail: step.id,
            stateId: state.id,
            style: EActionPlayStyle[EActionPlayStyle.Single] as TActionPlayStyle,
            speed: 1,
            audioId: "",
            animation: "",
            enabled: true,
        };
        this.getComponent(CVMeta).actions.insert(action);
        return state;
    }

    /** Removes the step's actions, and their states unless other actions still use them. */
    deleteStepActions(stepId: string)
    {
        const actions = this.getStepActions(stepId);
        const metas = this.getGraphComponents(CVMeta);
        metas.forEach(meta => actions.forEach(action => meta.actions.remove(action.id)));

        actions.forEach(action => {
            const isUsed = metas.some(meta => meta.actions.items.some(other => other.stateId === action.stateId));
            if (action.stateId && !isUsed) {
                this.snapshots.deleteDeltaState(action.stateId);
            }
        });
    }

    /**
     * Converts tour steps owning a full snapshot (legacy format) into sparse delta states, each linked
     * to its step by a state change action of the scene meta. Composing the converted states reproduces
     * the legacy snapshots at every step (see sparsifySteps).
     */
    migrateLegacySteps()
    {
        const machine = this.snapshots;
        const targetPaths = machine.getTargetProperties().map(property => machine.getPropertyPath(property));
        const navigationPaths = this.setup.navigation.snapshotProperties.map(property => machine.getPropertyPath(property));

        this._tours.forEach(tour => {
            const legacy = tour.steps.map(step => {
                const state = machine.getState(step.id);
                return state && !("paths" in state) ? state : null;
            });
            const sparse = sparsifySteps(legacy.map(state => state ? { paths: targetPaths, values: state.values } : null), navigationPaths);

            tour.steps.forEach((step, index) => {
                const state = legacy[index];
                if (state) {
                    machine.deleteState(step.id);
                    this.createStepState(step, sparse[index], state);
                }
            });
        });
    }

    /** Tweens to the values of the given step (jumps to them if tween is false). */
    protected playStep(tour: ITour, index: number, tween: boolean)
    {
        const steps = this.getTourStates(tour);
        const transition = steps[index][0] || { curve: EEasingCurve.EaseOutQuad, duration: 1, threshold: 0.5 };
        this.playValues(composeStep(this.base, steps, index), touchedPaths(steps), {
            curve: transition.curve,
            duration: tween ? transition.duration : 0,
            threshold: transition.threshold,
        }, index === 0);  // normalize orbit on tour start
    }

    protected playValues(values: ValueMap, paths: Iterable<string>, transition: { curve: EEasingCurve, duration: number, threshold: number }, normalizeOrbit: boolean = false)
    {
        const machine = this.snapshots;
        const state: IDeltaState = { id: CVTours.stepStateId, title: "", paths: [], values: [], ...transition };
        for (const path of paths) {
            if (values.has(path)) {
                state.paths.push(path);
                state.values.push(values.get(path));
            }
        }

        machine.endTween();
        if (normalizeOrbit) {
            this.normalizeViewOrbit(state);
        }
        machine.setState(state);
        machine.activateDelta(state.id);
    }

    // helper function to bring target orbit into alignment with current view orbit
    protected normalizeViewOrbit(state: IDeltaState) {
        const orbit = this.setup.navigation.ins.orbit;
        const target = state.values[state.paths.indexOf(this.snapshots.getPropertyPath(orbit))];
        if(target) {
            orbit.value.forEach((n, i) => {
                const mult = Math.round((target[i]-n)/360);
                orbit.value[i] += 360*mult;
            });
        }
    }
}