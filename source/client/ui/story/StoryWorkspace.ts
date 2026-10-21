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
import CVPoseTask from "../../components/CVPoseTask";
import CVAnnotationsTask from "../../components/CVAnnotationsTask";
import CVToursTask from "../../components/CVToursTask";
import DocumentView, { customElement, html } from "../explorer/DocumentView";
import ArticleEditor from "./ArticleEditor";
import AssetPanel from "./AssetPanel";
import CollectionPanel from "./CollectionPanel";
import ExplorerPanel from "./ExplorerPanel";
import InspectorPanel from "./InspectorPanel";
import NavigatorPanel from "./NavigatorPanel";
import StatePanel from "./StatePanel";
import SettingsTaskView from "./SettingsTaskView";
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
    private settings: SettingsTaskView;
    private bottomTasks = new Set<string>(["CVDerivativesTask", "CVCaptureTask"]);
    private article: ArticleEditor;
    private tour: TourPanel;
    private states: StatePanel;
    private hierarchy: HierarchyTreeView;
    private inspector: InspectorPanel;
    private navigationIndex = 0;
    private showStates = false;
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
        this.task.showTask = task => task instanceof CVPoseTask || task instanceof CVAnnotationsTask;
        this.bottomTask = new TaskPanel(system);
        this.bottomTask.showTask = task => this.bottomTasks.has(task.typeName);
        this.settings = new SettingsTaskView(system);
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
        if (next) {
            this.subscriber.on(next.setup.tours.ins.enabled, next.setup.tours.outs.tourIndex);
        }
        this.showStates = false;
        this.requestUpdate();
    }

    private onTask()
    {
        this.showStates = false;
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
        this.requestUpdate();
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
        const contextualTask = activeTask instanceof CVPoseTask || activeTask instanceof CVAnnotationsTask;
        const hasTask = contextualTask || !!this.nodes.activeNode;
        const hasBottomTask = !!activeTask && this.bottomTasks.has(activeTask.typeName);
        const hasArticle = this.article.hasArticle;
        const tours = this.activeDocument && this.activeDocument.setup.tours;
        const hasTour = this.tasks.activeComponent instanceof CVToursTask &&
            tours && tours.ins.enabled.value && !!tours.activeTour;
        const editor = this.showStates ? "states" : hasArticle ? "article" : hasTour ? "tour" : null;
        const navigation = [this.navigator, this.assets, this.collection];
        const titles = ["Navigator", "Media", "Collection"];

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
                    <ff-splitter direction="vertical" margin="100" ?hidden=${!hasTask}></ff-splitter>
                    <section class="sv-workspace-region sv-workspace-task" aria-label="Context" ?hidden=${!hasTask}>
                        <div class="sv-workspace-region" ?hidden=${!contextualTask}>${this.task}</div>
                        <div class="sv-workspace-region sv-panel" ?hidden=${contextualTask}>${this.settings}</div>
                    </section>
                </div>
                <ff-splitter margin="180"></ff-splitter>
                <div class="sv-workspace-column sv-workspace-main">
                    <section class="sv-workspace-region sv-workspace-explorer" aria-label="Explorer">${this.explorer}</section>
                    <ff-splitter direction="vertical" margin="120" ?hidden=${!hasBottomTask}></ff-splitter>
                    <section class="sv-workspace-region sv-workspace-bottom-task" aria-label="Tools" ?hidden=${!hasBottomTask}>${this.bottomTask}</section>
                    <ff-splitter direction="vertical" margin="120" ?hidden=${!editor}></ff-splitter>
                    <section class="sv-workspace-region sv-workspace-editor" aria-label="Editor" ?hidden=${!editor}>
                        <div class="sv-workspace-region" ?hidden=${editor !== "article"}>${this.article}</div>
                        <div class="sv-workspace-region" ?hidden=${editor !== "tour"}>${this.tour}</div>
                        <div class="sv-workspace-region" ?hidden=${editor !== "states"}>${this.states}</div>
                    </section>
                    <div class="sv-workspace-tools">
                        <ff-button text="State Editor" ?selected=${this.showStates}
                            aria-pressed=${this.showStates ? "true" : "false"}
                            @click=${() => { this.showStates = !this.showStates; this.requestUpdate(); }}></ff-button>
                    </div>
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
