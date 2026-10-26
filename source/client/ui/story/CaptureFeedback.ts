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

import Notification from "@ff/ui/Notification";

import CVCaptureTask, { ISceneStateCaptureEvent, ISceneStateSaveEvent } from "../../components/CVCaptureTask";

////////////////////////////////////////////////////////////////////////////////

/**
 * Shows a Capture save as a photo: the viewport flashes when the scene state is captured, and once the scene
 * is saved, the picture flies into the confirmation. Nothing flies if the scene isn't saved.
 */
export default class CaptureFeedback
{
    private task: CVCaptureTask = null;

    constructor(private getViewport: () => HTMLElement)
    {
    }

    /** Follows the given task's captures; null stops following. Pending saves are still shown. */
    attach(task: CVCaptureTask)
    {
        this.task?.off<ISceneStateCaptureEvent>("scene-state-capture", this.onCapture, this);
        this.task = task;
        this.task?.on<ISceneStateCaptureEvent>("scene-state-capture", this.onCapture, this);
    }

    protected onCapture(event: ISceneStateCaptureEvent)
    {
        const viewport = this.getViewport();
        if (viewport) {
            const flash = document.createElement("div");
            flash.classList.add("sv-capture-flash");
            viewport.appendChild(flash);
            const animation = flash.animate([ { opacity: 0 }, { opacity: 0.85, offset: 0.15 }, { opacity: 0 } ],
                { duration: 250, easing: "ease-out" });
            animation.onfinish = animation.oncancel = () => flash.remove();
        }

        const { snapshot, rect } = event;
        if (snapshot && rect) {
            // Each capture is followed by exactly one save event from the same task.
            this.task.once<ISceneStateSaveEvent>("scene-state-save", saved => {
                if (saved.notification) {
                    this.fly(snapshot, rect, saved.notification);
                }
            });
        }
    }

    protected async fly(snapshot: HTMLCanvasElement, from: DOMRect, notification: Notification)
    {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            return;
        }

        await notification.updateComplete;
        // Closed or never shown: there is nowhere to land.
        if (!notification.isConnected || notification.classList.contains("ff-out")) {
            return;
        }
        const to = notification.getBoundingClientRect();
        if (!to.height || !from.width || !from.height) {
            return;
        }

        // Land as a small picture at the start of the confirmation.
        const scale = Math.max(to.height - 16, 8) / from.height;
        const x = to.left + 8 - from.left;
        const y = to.top + 8 - from.top;

        snapshot.classList.add("sv-capture-snapshot");
        Object.assign(snapshot.style, {
            left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`,
        });
        document.body.appendChild(snapshot);

        const animation = snapshot.animate([
            { transform: "none", opacity: 1 },
            { opacity: 1, offset: 0.7 },
            { transform: `translate(${x}px, ${y}px) scale(${scale})`, opacity: 0 },
        ], { duration: 700, easing: "cubic-bezier(0.5, 0, 0.75, 0)" });
        animation.onfinish = animation.oncancel = () => snapshot.remove();
    }
}
