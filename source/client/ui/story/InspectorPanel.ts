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

import PropertyTree from "@ff/scene/ui/PropertyTree";
import SystemView, { customElement } from "@ff/scene/ui/SystemView";

////////////////////////////////////////////////////////////////////////////////

@customElement("sv-inspector-panel")
export default class InspectorPanel extends SystemView
{
    firstConnected()
    {
        this.classList.add("ff-scroll-y", "sv-panel", "sv-inspector-panel");
        this.appendChild(new PropertyTree(this.system));
    }
}