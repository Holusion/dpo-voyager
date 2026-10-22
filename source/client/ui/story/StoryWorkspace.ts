/**
 * 3D Foundation Project
 * Copyright 2026 Smithsonian Institution
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

import Subscriber from "@ff/core/Subscriber";
import HierarchyTreeView from "@ff/scene/ui/HierarchyTreeView";
import "@ff/ui/Button";
import "@ff/ui/Splitter";

import StoryApplication from "../../applications/StoryApplication";
import CVDocument from "../../components/CVDocument";
import CVTaskProvider from "../../components/CVTaskProvider";
import CVNodeProvider from "../../components/CVNodeProvider";
import CVAnnotationView from "../../components/CVAnnotationView";
import NVNode from "../../nodes/NVNode";
import CVAnnotationsTask from "../../components/CVAnnotationsTask";
import CVToursTask from "../../components/CVToursTask";
import CVPoseTask from "../../components/CVPoseTask";
import DocumentView, { customElement, html } from "../explorer/DocumentView";
import ArticleEditor from "./ArticleEditor";
import AssetPanel from "./AssetPanel";
import CollectionPanel from "./CollectionPanel";
import ExplorerPanel from "./ExplorerPanel";
import InspectorPanel from "./InspectorPanel";
import NavigatorPanel from "./NavigatorPanel";
import StatePanel from "./StatePanel";
import SettingsPanel from "./SettingsPanel";
import TaskPanel from "./TaskPanel";
import TourPanel from "./TourPanel";

/** Fixed regions stay mounted so changing tasks or modes cannot destroy editor state. */
@customElement("sv-story-workspace")
export default class StoryWorkspace extends DocumentView
{
    private navigator: NavigatorPanel;
    private assets: AssetPanel;
    private collection: CollectionPanel;
    private explorer: ExplorerPanel;
    private task: TaskPanel;
    private bottomTask: TaskPanel;
    private settings: SettingsPanel;
    private bottomTasks = new Set<string>(["CVCaptureTask", "CVPoseTask", "CVAnnotationsTask", "CVArticlesTask", "CVToursTask"]);
    private article: ArticleEditor;
    private tour: TourPanel;
    private states: StatePanel;
    private hierarchy: HierarchyTreeView;
    private inspector: InspectorPanel;
    private navigationIndex = 0;
    private contextTab: "settings" | "task" = "settings";
    private showStates = false;
    private showTourSteps = false;
    private subscriber = new Subscriber("value", this.onUpdate, this);

    private get tasks() {
        return this.system.getMainComponent(CVTaskProvider);
    }

    private get nodes() {
        return this.system.getMainComponent(CVNodeProvider);
    }

    constructor(application: StoryApplication)
    {
        super(application.system);
        const system = this.system;
        this.navigator = new NavigatorPanel(system);
        this.assets = new AssetPanel(system);
        this.collection = new CollectionPanel(system);
        this.explorer = new ExplorerPanel(application.explorer);
        this.task = new TaskPanel(system);
        this.task.showTask = task => !this.bottomTasks.has(task.typeName);
        this.task.showHeader = false;
        this.bottomTask = new TaskPanel(system);
        this.bottomTask.showTask = task => this.bottomTasks.has(task.typeName);
        this.bottomTask.showHeader = task => !["CVAnnotationsTask", "CVArticlesTask", "CVToursTask"].includes(task.typeName);
        this.settings = new SettingsPanel(system);
        this.article = new ArticleEditor(system);
        this.tour = new TourPanel(system);
        this.states = new StatePanel(system);
        this.hierarchy = new HierarchyTreeView(system);
        this.inspector = new InspectorPanel(system);
        this.addEventListener(ArticleEditor.changeEvent, () => {
            this.showStates = false;
            this.requestUpdate();
        });
    }

    protected connected()
    {
        super.connected();
        this.tasks.on("active-component", this.onTask, this);
        this.nodes.on("active-node", this.onUpdate, this);
        this.tasks.ins.mode.on("value", this.onMode, this);
    }

    protected disconnected()
    {
        this.tasks.off("active-component", this.onTask, this);
        this.nodes.off("active-node", this.onUpdate, this);
        this.tasks.ins.mode.off("value", this.onMode, this);
        this.subscriber.off();
        super.disconnected();
    }

    protected onActiveDocument(previous: CVDocument, next: CVDocument)
    {
        this.subscriber.off();
        if (previous) {
            previous.setup.viewer.ins.activeAnnotation.off("value", this.onAnnotation, this);
        }
        if (next) {
            this.subscriber.on(next.setup.tours.ins.enabled, next.setup.tours.outs.tourIndex,
                next.setup.tours.outs.tourTitle, next.setup.language.outs.activeLanguage);
            next.setup.viewer.ins.activeAnnotation.on("value", this.onAnnotation, this);
        }
        this.showStates = false;
        this.showTourSteps = false;
        this.requestUpdate();
    }

    private onTask()
    {
        const task = this.tasks.activeComponent;
        this.contextTab = task && !this.bottomTasks.has(task.typeName) ? "task" : "settings";
        this.settings.poseMode = task instanceof CVPoseTask;
        this.settings.requestUpdate();
        this.showStates = false;
        this.showTourSteps = false;
        // An article opened from Media also closes before the tour editor takes over.
        if (this.tasks.activeComponent instanceof CVToursTask && this.article.hasArticle) {
            this.article.closeArticle();
        }
        this.requestUpdate();
    }

    private onMode()
    {
        this.assets.requestUpdate();
        this.showStates = false;
        this.showTourSteps = false;
        this.requestUpdate();
    }

    private onAnnotation()
    {
        const id = this.activeDocument?.setup.viewer.ins.activeAnnotation.value;
        if (!id) return;

        const view = this.system.getComponents(CVAnnotationView)
            .find(view => view.getAnnotations().some(annotation => annotation.id === id));
        const task = this.tasks.scopedComponents.find(task => task instanceof CVAnnotationsTask);
        if (view && task) {
            this.nodes.activeNode = view.node as NVNode;
            this.tasks.activeComponent = task;
        }
    }

    protected updated()
    {
        // Explorer's canvas needs to follow visibility changes as well as splitter drags.
        window.dispatchEvent(new Event("resize"));
    }

    protected render()
    {
        const expert = this.tasks.expertMode;
        const activeTask = this.tasks.activeComponent;
        const contextualTask = !!activeTask && !this.bottomTasks.has(activeTask.typeName);
        const hasBottomTask = !!activeTask && this.bottomTasks.has(activeTask.typeName);
        const hasArticle = this.article.hasArticle;
        const tours = this.activeDocument && this.activeDocument.setup.tours;
        const hasTour = this.tasks.activeComponent instanceof CVToursTask &&
            tours && tours.ins.enabled.value && !!tours.activeTour;
        const editor = this.showStates ? "states" : hasArticle ? "article" :
            hasTour && this.showTourSteps ? "tour" : null;
        const pose = activeTask instanceof CVPoseTask;
        if (this.settings.poseMode !== pose) {
            this.settings.poseMode = pose;
            this.settings.requestUpdate();
        }
        const hasBottom = hasBottomTask || !!editor;
        const navigation = [this.navigator, this.assets, this.collection];
        const titles = ["Navigator", "Media", "Collection"];
        const language = this.activeDocument?.setup.language;
        const taskTitle = contextualTask ? language?.getUILocalizedString(activeTask.text) || activeTask.text : "";

        return html`
            <div class="sv-workspace-row">
                <div class="sv-workspace-column sv-workspace-sidebar">
                    <section class="sv-workspace-region sv-workspace-navigation" aria-label="Navigation">
                        <div class="sv-workspace-tabs" role="tablist" aria-label="Navigation">
                            ${titles.map((title, index) => html`
                                <button id=${`story-tab-${index}`} role="tab"
                                    aria-controls=${`story-navigation-${index}`}
                                    aria-selected=${this.navigationIndex === index ? "true" : "false"}
                                    tabindex=${this.navigationIndex === index ? 0 : -1}
                                    @keydown=${(event: KeyboardEvent) => this.onNavigationKey(event, index)}
                                    @click=${() => this.selectNavigation(index)}>${title}</button>
                            `)}
                        </div>
                        ${navigation.map((panel, index) => html`
                            <div class="sv-workspace-region" role="tabpanel" id=${`story-navigation-${index}`}
                                aria-labelledby=${`story-tab-${index}`} ?hidden=${this.navigationIndex !== index}>${panel}</div>
                        `)}
                    </section>
                    <ff-splitter direction="vertical" margin="100"></ff-splitter>
                    <section class="sv-workspace-region sv-workspace-task" aria-label="Context">
                        <div class="sv-workspace-tabs" role="tablist" aria-label="Context" ?hidden=${!contextualTask || pose}>
                            <button id="story-context-settings-tab" role="tab" aria-controls="story-context-settings"
                                aria-selected=${this.contextTab === "settings" ? "true" : "false"}
                                tabindex=${this.contextTab === "settings" ? 0 : -1}
                                @keydown=${(event: KeyboardEvent) => this.onContextKey(event)}
                                @click=${() => this.selectContext("settings")}>${language?.getUILocalizedString("Settings") || "Settings"}</button>
                            <button id="story-context-task-tab" role="tab" aria-controls="story-context-task"
                                aria-selected=${this.contextTab === "task" ? "true" : "false"}
                                tabindex=${this.contextTab === "task" ? 0 : -1}
                                @keydown=${(event: KeyboardEvent) => this.onContextKey(event)}
                                @click=${() => this.selectContext("task")}>${taskTitle}</button>
                        </div>
                        <div class="sv-panel-header sv-workspace-context-title">
                            <ff-icon name=${contextualTask && this.contextTab === "task" ? activeTask.icon : "eye"}></ff-icon>
                            <div class="ff-text">${pose ? "Model Settings" : contextualTask && this.contextTab === "task" ? taskTitle : language?.getUILocalizedString("Settings") || "Settings"}</div>
                        </div>
                        <div class="sv-workspace-region sv-panel" id="story-context-settings"
                            role=${contextualTask ? "tabpanel" : "region"} aria-label="Settings"
                            ?hidden=${contextualTask && this.contextTab !== "settings"}>${this.settings}</div>
                        <div class="sv-workspace-region" id="story-context-task" role="tabpanel"
                            aria-labelledby="story-context-task-tab"
                            ?hidden=${!contextualTask || this.contextTab !== "task"}>${this.task}</div>
                    </section>
                </div>
                <ff-splitter margin="180"></ff-splitter>
                <div class="sv-workspace-column sv-workspace-main">
                    <section class="sv-workspace-region sv-workspace-explorer" aria-label="Explorer">${this.explorer}</section>
                    <ff-splitter direction="vertical" margin="120" ?hidden=${!hasBottom}
                        @pointerdown=${() => this.classList.add("sv-workspace-resizing")}
                        @pointerup=${() => this.classList.remove("sv-workspace-resizing")}
                        @pointercancel=${() => this.classList.remove("sv-workspace-resizing")}></ff-splitter>
                    <section class="sv-workspace-region sv-workspace-bottom" aria-label=${editor ? "Editor" : "Tools"}
                        ?data-open=${hasBottom} ?inert=${!hasBottom}
                        aria-hidden=${hasBottom ? "false" : "true"}
                        @transitionend=${(event: TransitionEvent) => {
                            if (event.propertyName === "flex-basis") window.dispatchEvent(new Event("resize"));
                        }}>
                        <div class="sv-workspace-region" ?hidden=${!!editor} @sv-open-tour-steps=${this.onOpenTourSteps}>${this.bottomTask}</div>
                        <div class="sv-workspace-region" ?hidden=${!editor}>
                            <div class="sv-workspace-region" ?hidden=${editor !== "article"}>${this.article}</div>
                            <div class="sv-workspace-region" ?hidden=${editor !== "tour"} @sv-back-to-tours=${this.onBackToTours}>
                                <div class="sv-workspace-breadcrumb">
                                    <ff-button icon=${CVToursTask.icon} text=${language?.getUILocalizedString("Tours") || "Tours"} @click=${this.onBackToTours}></ff-button>
                                    <span aria-hidden="true">&gt;</span>
                                    <span class="ff-ellipsis">${hasTour ? tours.title : ""}</span>
                                </div>
                                ${this.tour}
                            </div>
                            <div class="sv-workspace-region" ?hidden=${editor !== "states"}>${this.states}</div>
                        </div>
                    </section>
                </div>
                <ff-splitter margin="180" ?hidden=${!expert}></ff-splitter>
                <div class="sv-workspace-column sv-workspace-inspection" ?hidden=${!expert}>
                    <section class="sv-workspace-region" aria-label="Hierarchy">${this.hierarchy}</section>
                    <ff-splitter direction="vertical" margin="100"></ff-splitter>
                    <section class="sv-workspace-region" aria-label="Inspector">${this.inspector}</section>
                </div>
            </div>
        `;
    }

    private selectNavigation(index: number)
    {
        this.navigationIndex = index;
        this.requestUpdate();
    }

    private onOpenTourSteps()
    {
        this.showTourSteps = true;
        this.requestUpdate();
    }

    private onBackToTours()
    {
        this.showTourSteps = false;
        this.requestUpdate();
    }

    private selectContext(tab: "settings" | "task")
    {
        this.contextTab = tab;
        this.requestUpdate();
    }

    private onContextKey(event: KeyboardEvent)
    {
        const tab = event.key === "ArrowLeft" || event.key === "Home" ? "settings" :
            event.key === "ArrowRight" || event.key === "End" ? "task" : null;
        if (tab) {
            event.preventDefault();
            this.selectContext(tab);
            this.updateComplete.then(() => (this.querySelector(`#story-context-${tab}-tab`) as HTMLElement).focus());
        }
    }

    private onNavigationKey(event: KeyboardEvent, index: number)
    {
        const count = 3;
        const next = event.key === "ArrowRight" ? (index + 1) % count :
            event.key === "ArrowLeft" ? (index + count - 1) % count :
            event.key === "Home" ? 0 : event.key === "End" ? count - 1 : null;
        if (next !== null) {
            event.preventDefault();
            this.selectNavigation(next);
            this.updateComplete.then(() => (this.querySelector(`#story-tab-${next}`) as HTMLElement).focus());
        }
    }
}
