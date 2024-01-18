/**
 * 3D Foundation Project
 * Copyright 2019 Smithsonian Institution
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

import Derivative, { EDerivativeUsage, EDerivativeQuality, EAssetType, Asset} from "../../models/Derivative";


////////////////////////////////////////////////////////////////////////////////

export interface ISelectDerivativeEvent extends CustomEvent
{
    target: DerivativeList;
    detail: {
        derivative: Derivative;
    }
}

export interface ISelectAssetEvent extends CustomEvent
{
    target: DerivativeList;
    detail: {
        asset: Asset;
        derivative: Derivative;
    }
}
@customElement("sv-derivative-list")
class DerivativeList extends List<Derivative>
{
    @property({ attribute: false })
    selectedItem: Derivative = null;

    @property({ attribute: false })
    loadedItem: Derivative = null;

    protected firstConnected()
    {
        super.firstConnected();
        this.classList.add("sv-derivative-list");
    }

    protected renderAsset(item :Derivative, asset :Asset){


        let icon = "file";
        switch(asset.data.type){
            case EAssetType.Model:
                icon = "cube";
                break;
            case EAssetType.Image:
                icon = "camera";
                break;
        }
        return html`<span class="ff-derivative-asset">
            <ff-icon name="${icon}"></ff-icon>
            <span style="flex: 1 1 auto">${asset.data.uri}</span>
            <a style="cursor: pointer" @click=${()=>this.onRemoveAsset(asset)}><ff-icon style="fill: var(--color-danger)" name="trash"></ff-icon></a>
        </span>`
    }


    protected renderItem(item: Derivative)
    {
        const isSelected = item == this.selectedItem;
        const isLoaded = item === this.loadedItem;
        //<ff-icon style="fill: var(--color-danger)" name="trash" @click=${(e)=>this.onRemoveItem(e, item)}></ff-icon>
        return html`
            <div class="ff-derivative-title">
                <ff-icon name=${isLoaded ? "check" : "empty"} title="${isLoaded ? "current model" : ""}"></ff-icon>
                <span title=${item.data.assets.map(a=>a.data.uri).join("\n")} style="flex: 1 1 auto;">${EDerivativeUsage[item.data.usage]} - ${EDerivativeQuality[item.data.quality]}</span>
                <ff-icon name="caret-${isSelected? "up":"down"}"></ff-icon>
            </div>
            ${isSelected? html`<div class="ff-derivative-assets">
                ${item.data.assets.map(this.renderAsset.bind(this, item))}
            </div>`: null}
        `;
    }

    protected isItemSelected(item: Derivative)
    {
        return item === this.selectedItem;
    }

    protected onClickItem(event: MouseEvent, item: Derivative)
    {
        this.dispatchEvent(new CustomEvent("select", {
            detail: { derivative: item }
        }));
    }

    protected onRemoveAsset(asset: Asset){
        this.dispatchEvent(new CustomEvent("remove-asset", {
            detail: { asset: asset, derivative: this.selectedItem }
        }));
    }

    protected onRemoveItem(event :MouseEvent, item :Derivative){
        event.stopPropagation();
        this.dispatchEvent(new CustomEvent("remove", {
            detail: { derivative: item }
        }));
        return false;
    }

    protected onClickEmpty(event: MouseEvent)
    {
        this.dispatchEvent(new CustomEvent("select", {
            detail: { derivative: null }
        }));
    }
}