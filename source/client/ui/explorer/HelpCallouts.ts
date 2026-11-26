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

import CustomElement, { customElement, property, html } from "@ff/ui/CustomElement";
import { styleMap } from "lit-html/directives/style-map";
import { ifDefined } from "lit-html/directives/if-defined";

////////////////////////////////////////////////////////////////////////////////

/**
 * Side of its target a callout's bubble is on. Above it, the bubble is aligned with the
 * target's edge nearest the middle of the callouts element's edge, to stay inside it.
 */
export type THelpCalloutSide = "right" | "left" | "top";

export interface IHelpCallout
{
    /** Selector of the element the callout points at, looked up in `root`. */
    selector: string;
    /** Text of the bubble. Without text, the callout has no bubble, only its ring. */
    text: string;
    /** By default, right of targets in the left half, else left of them. */
    side?: THelpCalloutSide;
}

/** Dispatched with the target when a callout is clicked: the callout stands for its target. */
export interface IHelpCalloutSelectEvent extends CustomEvent<{ target: HTMLElement }>
{
    type: "select";
}

interface ICalloutLayout
{
    target: HTMLElement;
    text: string;
    /** Accessible name: the target's title, if any. */
    label: string;
    disabled: boolean;
    /** Target's box, relative to the callouts element. */
    left: number;
    top: number;
    width: number;
    height: number;
    side: THelpCalloutSide;
    /** Whether the target is in the right half. */
    end: boolean;
    /** Whether the target is in the bottom half. */
    lower: boolean;
}

/**
 * Callouts pointing at UI elements: a ring around each, and a bubble with its text
 * beside it. Each ring is a button standing for its target, over it: clicking it
 * dispatches a "select" event (see {@link IHelpCalloutSelectEvent}), unless the target
 * is disabled. The bubble is text only. Covers its offset parent, and lays the callouts out from the targets'
 * boxes. Targets that don't exist (yet) or aren't displayed get no callout. Follows
 * the targets as they appear, disappear or move.
 *
 * So that the parent can keep its other content clear of the callouts, sets on it:
 * - for those right of their target (on the left side): `--sv-help-callouts-left`
 *   (their width) if at least {@link minFreeWidth} remains beside them, else
 *   `--sv-help-callouts-top` (their height);
 * - for the others with their target in the bottom half: `--sv-help-callouts-bottom`
 *   (the height from their top to the bottom).
 */
@customElement("sv-help-callouts")
export default class HelpCallouts extends CustomElement
{
    /** Element the targets are looked up in. */
    @property({ attribute: false })
    root: ParentNode = null;

    @property({ attribute: false })
    callouts: IHelpCallout[] = [];

    /** Accessible name of the list of callouts. */
    @property({ type: String })
    label = "";

    /** Width the parent's content needs beside the callouts, else it goes below them. */
    @property({ type: Number })
    minFreeWidth = 320;

    /** If set when connected, focuses the first enabled callout once laid out. */
    @property({ type: Boolean })
    focusFirst = false;

    protected focusPending = false;
    // where the extents are set: the parent is gone once disconnected
    protected extentsElement: HTMLElement = null;

    protected layouts: ICalloutLayout[] = [];
    protected frame = 0;
    protected resizeObserver: ResizeObserver = null;
    protected mutationObserver: MutationObserver = null;

    constructor()
    {
        super();
        this.scheduleLayout = this.scheduleLayout.bind(this);
    }

    protected firstConnected()
    {
        super.firstConnected();
        this.classList.add("sv-help-callouts");
        this.setAttribute("role", "list");
    }

    protected connected()
    {
        super.connected();
        this.resizeObserver = new ResizeObserver(this.scheduleLayout);
        this.resizeObserver.observe(this);
        this.mutationObserver = new MutationObserver(this.scheduleLayout);
        window.addEventListener("resize", this.scheduleLayout);
        this.observeRoot();
        this.scheduleLayout();
        this.focusPending = this.focusFirst;
    }

    protected disconnected()
    {
        window.removeEventListener("resize", this.scheduleLayout);
        this.resizeObserver.disconnect();
        this.mutationObserver.disconnect();
        cancelAnimationFrame(this.frame);
        this.frame = 0;
        const style = this.extentsElement?.style;
        style?.removeProperty("--sv-help-callouts-left");
        style?.removeProperty("--sv-help-callouts-top");
        style?.removeProperty("--sv-help-callouts-bottom");
        this.extentsElement = null;
        super.disconnected();
    }

    protected update(changedProperties)
    {
        if (changedProperties.has("root") && this.mutationObserver) {
            this.observeRoot();
        }
        if (changedProperties.has("root") || changedProperties.has("callouts")) {
            this.scheduleLayout();
        }
        if (changedProperties.has("label")) {
            this.label ? this.setAttribute("aria-label", this.label) : this.removeAttribute("aria-label");
        }
        super.update(changedProperties);
    }

    protected observeRoot()
    {
        this.mutationObserver.disconnect();
        if (this.root) {
            // targets appear and disappear with the features of the scene, and get disabled
            this.mutationObserver.observe(this.root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "disabled"] });
        }
    }

    protected scheduleLayout()
    {
        if (!this.frame) {
            this.frame = requestAnimationFrame(() => {
                this.frame = 0;
                this.layout();
            });
        }
    }

    protected layout()
    {
        const box = this.getBoundingClientRect();
        const layouts: ICalloutLayout[] = [];

        for (const callout of this.callouts) {
            const target = this.root?.querySelector(callout.selector) as HTMLElement;
            const rect = target?.getBoundingClientRect();
            if (!rect || rect.width === 0 || rect.height === 0) {
                continue;
            }

            const left = rect.left - box.left;
            const top = rect.top - box.top;
            const end = left + rect.width / 2 >= box.width / 2;
            const lower = top + rect.height / 2 >= box.height / 2;
            const side = callout.side || (end ? "left" : "right");
            layouts.push({
                target, text: callout.text, label: target.getAttribute("title") || "", left, top, width: rect.width, height: rect.height, side, end, lower,
                // ff-button only disables pointer events
                disabled: (target as any).disabled === true || target.classList.contains("ff-disabled"),
            });
        }

        this.layouts = layouts;
        this.requestUpdate();
    }

    protected updated(changedProperties)
    {
        super.updated(changedProperties);

        if (this.focusPending && this.layouts.length > 0) {
            this.focusPending = false;
            Array.from(this.querySelectorAll<HTMLButtonElement>(".sv-help-callout-ring")).find(ring => !ring.disabled)?.focus();
        }

        // measures the callouts, once rendered
        const box = this.getBoundingClientRect();
        let right = 0, bottom = 0, lowerTop = box.height;
        for (const callout of Array.from(this.querySelectorAll(".sv-help-callout-right"))) {
            for (const part of Array.from(callout.children)) {
                const rect = part.getBoundingClientRect();
                right = Math.max(right, rect.right - box.left);
                bottom = Math.max(bottom, rect.bottom - box.top);
            }
        }
        for (const callout of Array.from(this.querySelectorAll(".sv-help-callout-lower:not(.sv-help-callout-right)"))) {
            for (const part of Array.from(callout.children)) {
                lowerTop = Math.min(lowerTop, part.getBoundingClientRect().top - box.top);
            }
        }

        this.extentsElement = this.parentElement;
        const style = this.extentsElement?.style;
        if (style) {
            const beside = box.width - right >= this.minFreeWidth;
            style.setProperty("--sv-help-callouts-left", beside ? `${Math.ceil(right)}px` : "0px");
            style.setProperty("--sv-help-callouts-top", beside ? "0px" : `${Math.ceil(bottom)}px`);
            style.setProperty("--sv-help-callouts-bottom", `${Math.ceil(Math.max(0, box.height - lowerTop))}px`);
        }
    }

    protected onSelect(target: HTMLElement)
    {
        this.dispatchEvent(new CustomEvent("select", { detail: { target } }));
    }

    protected render()
    {
        return html`${this.layouts.map((layout, index) => html`
            <div role="listitem" class="sv-help-callout sv-help-callout-${layout.side} ${layout.end ? "sv-help-callout-end" : ""} ${layout.lower ? "sv-help-callout-lower" : ""}" style=${styleMap({
                left: `${layout.left}px`, top: `${layout.top}px`,
                width: `${layout.width}px`, height: `${layout.height}px`,
                "--sv-help-target-width": `${layout.width}px`,
            })}>
                <button class="sv-help-callout-ring" aria-label=${layout.label || layout.text}
                    aria-describedby=${ifDefined(layout.text ? `sv-help-callout-${index}` : undefined)}
                    ?disabled=${layout.disabled} @click=${() => this.onSelect(layout.target)}></button>
                ${layout.text ? html`<div class="sv-help-callout-bubble" id=${`sv-help-callout-${index}`}>${layout.text}</div>` : null}
            </div>`)}`;
    }
}
