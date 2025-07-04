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

import { customElement, property, html } from "@ff/ui/CustomElement";
import List from "@ff/ui/List";

import Annotation from "../../models/Annotation";
import { DEFAULT_LANGUAGE, ELanguageType } from "client/schema/common";

////////////////////////////////////////////////////////////////////////////////

export interface ISelectAnnotationEvent extends CustomEvent
{
    target: AnnotationList;
    detail: {
        annotation: Annotation;
    }
}

@customElement("sv-annotation-list")
class AnnotationList extends List<Annotation>
{
    @property({ attribute: false })
    selectedItem: Annotation = null;

    @property({type: ELanguageType})
    activeLanguage: ELanguageType = ELanguageType[DEFAULT_LANGUAGE];

    @property({type: ELanguageType})
    primarySceneLanguage: ELanguageType = ELanguageType[DEFAULT_LANGUAGE];

    protected firstConnected()
    {
        super.firstConnected();
        this.classList.add("sv-annotation-list");
    }

    protected renderItem(item: Annotation)
    {
        const primaryTitle = item.titleIn(this.primarySceneLanguage);
        const activeTitle = item.titleIn(this.activeLanguage);
        const missingTitle = html `<span class="sv-missing-translation">Missing content</span>`
        return html`<div class="ff-flex-row ff-group">
            <div class="sv-task-item">${ primaryTitle? primaryTitle : missingTitle}</div>
            <div class="sv-task-item sv-item-border-l">${activeTitle ? activeTitle : missingTitle}
            </div></div>`
    }

    protected isItemSelected(item: Annotation)
    {
        return item === this.selectedItem;
    }

    protected onClickItem(event: MouseEvent, item: Annotation)
    {
        this.dispatchEvent(new CustomEvent("select", {
            detail: { annotation: item }
        }));
    }

    protected onClickEmpty(event: MouseEvent)
    {
        this.dispatchEvent(new CustomEvent("select", {
            detail: { annotation: null }
        }));
    }
}