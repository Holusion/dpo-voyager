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

import SystemView, { customElement, html } from "@ff/scene/ui/SystemView";

import CVToolProvider, { IActiveToolEvent } from "../../components/CVToolProvider";
import CVTool from "../../components/CVTool";
import {getFocusableElements, focusTrap} from "../../utils/focusHelpers";
import CVSetup from "client/components/CVSetup";

////////////////////////////////////////////////////////////////////////////////

export interface IToolBarCloseEvent extends CustomEvent
{
    type: "close",
}

@customElement("sv-tool-bar")
export default class ToolBar extends SystemView
{
    protected needsFocus: boolean = false;

    protected get toolProvider() {
        return this.system.getMainComponent(CVToolProvider);
    }
    protected get setup() {
        return this.system.getComponent(CVSetup);
    }

    protected firstConnected()
    {
        super.firstConnected();
        this.classList.add("sv-bottom-bar-container", "sv-tool-bar");
        this.needsFocus = true;
    }

    protected connected()
    {
        super.connected();
        this.toolProvider.on<IActiveToolEvent>("active-component", this.onUpdate, this);
        this.setup.language.outs.activeLanguage.on("value", this.onUpdate, this);
        this.setup.navigation.ins.mode.on("value", this.onUpdate, this);
    }

    protected disconnected()
    {
        this.setup.navigation.ins.mode.off("value", this.onUpdate, this);
        this.setup.language.outs.activeLanguage.off("value", this.onUpdate, this);
        this.toolProvider.off<IActiveToolEvent>("active-component", this.onUpdate, this);
        super.disconnected();
    }

    protected render()
    {
        const tools = this.toolProvider.scopedComponents;
        const activeTool = this.toolProvider.activeComponent;
        const language = this.setup.language;

        const toolbarWrapper = activeTool ? html`<div>`: null;

        const toolButtons = tools.map(tool => tool.enabled ?
            html`<ff-button class="sv-tool-button" transparent text=${language.getLocalizedString(tool.text)} icon=${tool.icon}
                ?selected=${tool === activeTool} @click=${e => this.onSelectTool(tool)}></ff-button>` : null);

        return html`<div class="sv-blue-bar"><div id="toolmenu" role="region" aria-label=${activeTool ? activeTool.text : null} @close=${this.closeTool} @keydown=${e =>this.onKeyDownTool(e)}>${activeTool ? activeTool.createView() : null}</div>
            <div id="mainmenu" role="region" @keydown=${e =>this.onKeyDownMain(e)} aria-label="Tools and settings" class="sv-section">
                <ff-button class="sv-section-lead" transparent icon="close" title=${language.getLocalizedString("Close Tools")} @click=${this.onClose}></ff-button>
                <div class="sv-tool-buttons">${toolButtons}</div>
                <sv-tool-menu-view .system=${this.system}></sv-tool-menu-view>
            </div></div>`;
    }

    protected onSelectTool(tool: CVTool)
    {
        this.toolProvider.activeComponent = tool;
    }

    protected onClose(event: MouseEvent)
    {
        this.dispatchEvent(new CustomEvent("close"));
        event.stopPropagation();
    }

    protected update(changedProperties) {
        super.update(changedProperties);

        if(this.needsFocus) {
            const container = this.getElementsByClassName("sv-tool-button").item(0) as HTMLElement;
            container.focus();
            this.needsFocus = false;
        }
    }

    protected onKeyDownMain(e: KeyboardEvent)
    {
        if (e.code === "Escape") {
            e.preventDefault();
            this.dispatchEvent(new CustomEvent("close"));
        }
        else if(e.code === "Tab") {
            const element = Array.from(this.getElementsByTagName("div")).find(e => e.id === "mainmenu");
            focusTrap(getFocusableElements(element) as HTMLElement[], e);
        }
    }

    protected onKeyDownTool(e: KeyboardEvent)
    {
        if (e.code === "Escape") {
            e.preventDefault();
            this.closeTool();
        }
        else if(e.code === "Tab") {
            const element = Array.from(this.getElementsByTagName("div")).find(e => e.id === "toolmenu");
            focusTrap(getFocusableElements(element) as HTMLElement[], e);
        }
    }

    protected closeTool() 
    {
        const buttons = this.getElementsByTagName("ff-button");
        const activeButton = Array.from(buttons).find(button => {
            const label = button.getAttribute("text");
            return label === this.setup.language.getLocalizedString(this.toolProvider.activeComponent.text)
        });
        (activeButton as HTMLElement).focus();
        this.toolProvider.activeComponent = null;
    }
}
