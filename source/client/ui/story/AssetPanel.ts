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

import MessageBox from "@ff/ui/MessageBox";
import Notification from "@ff/ui/Notification";

import "@ff/scene/ui/AssetTree";

import CVMediaManager from "../../components/CVMediaManager";
import CVTaskProvider, { ETaskMode } from "../../components/CVTaskProvider";

import DocumentView, { customElement, property, html } from "../explorer/DocumentView";
import CAssetManager, { IAssetEntry, IAssetTreeChangeEvent } from "@ff/scene/components/CAssetManager";
import { IAssetDragEvent } from "@ff/scene/ui/AssetTree";

////////////////////////////////////////////////////////////////////////////////

@customElement("sv-asset-panel")
export default class AssetPanel extends DocumentView
{
    @property({attribute: false, type: Object})
    private root :IAssetEntry = null;

    protected basePath = "";

    protected get mediaManager() {
        return this.system.getMainComponent(CVMediaManager);
    }
    protected get taskProvider() {
        return this.system.getMainComponent(CVTaskProvider);
    }

    protected get assetManager() {
        return this.system.components.get(CAssetManager);
    }

    protected firstConnected()
    {
        this.classList.add("sv-panel", "sv-asset-panel");
    }

    protected connected()
    {
        super.connected();
        this.assetManager.on<IAssetTreeChangeEvent>("tree-change", this.onTreeChange, this);
        this.onTreeChange({ type: "tree-change", root: this.assetManager.root });
    }

    protected disconnected()
    {
        this.assetManager.off<IAssetTreeChangeEvent>("tree-change", this.onTreeChange, this);

        super.disconnected();
    }

    private onTreeChange(event: IAssetTreeChangeEvent){
        console.debug("Tree change event ");
        // traverse base path to find root tree node
        const parts = this.basePath.split("/").filter(part => part !== "");
        let root = event.root;
        if(!root) return;

        for (let i = 0; i < parts.length; ++i) {
            root = root.children.find(child => child.info.name === parts[i]);
            if (!root) {
                break;
            }
        }

        this.root = Object.assign({}, root || event.root);
        this.requestUpdate();
    }

    private onNodeDragStart(ev :IAssetDragEvent){
        ev.preventDefault();
        const {node:sourceTreeNode, event} = ev.detail;
        const mimeType = sourceTreeNode.info.type;
        if (mimeType === "image/jpeg" || mimeType === "image/png") {
            const url = this.assetManager.getAssetURL(sourceTreeNode.info.path);
            event.dataTransfer.setData("text/html", `<img src="${url}">`);
        }
    }

    private onNodeDrop(ev :IAssetDragEvent){
        ev.preventDefault();
        const {node:targetTreeNode, event} = ev.detail;
        const files = event.dataTransfer.files;

        if (files.length > 0) {
            //console.log("dropping files", files.item(0));
            this.assetManager.uploadFiles(files, targetTreeNode);
        }
        else {
            //const sourceTreeNode = this.getNodeFromDragEvent(event);
            //console.log("dropping asset", sourceTreeNode.info.path);
            this.assetManager.moveSelected(targetTreeNode);
        }
    }

    private onNodeOpen(ev :CustomEvent<IAssetEntry>){
        this.assetManager.open(ev.detail);
    }


    protected render()
    {
        const mode = this.taskProvider.ins.mode.value;

        return html`<div class="sv-panel-header">
                <ff-button icon="folder" title="Create Folder" @click=${this.onClickFolder}></ff-button>
                <ff-button icon="pen" title="Rename Item" @click=${this.onClickRename}></ff-button>
                <ff-button icon="trash" title="Delete Item" @click=${this.onClickDelete}></ff-button>
                <ff-button icon="redo" title="Refresh View" @click=${this.onClickRefresh}></ff-button>
            </div>
            <ff-asset-tree class="ff-flex-item-stretch" 
                .root=${this.root}
                draggable @dragstart=${this.onNodeDragStart} @drop=${this.onNodeDrop} @open=${this.onNodeOpen}
            >
            </ff-asset-tree>`;
    }

    protected onClickFolder()
    {
        const parentAsset = this.mediaManager.selectedAssets[0] || this.mediaManager.root;

        if (parentAsset && parentAsset.info.folder) {
            MessageBox.show("Create Folder", "Folder name:", "prompt", "ok-cancel", "New Folder").then(result => {
                if (result.ok && result.text) {
                    const infoText = `folder '${result.text}' in '${parentAsset.info.path}'`;
                    this.mediaManager.createFolder(parentAsset, result.text)
                        .then(() => Notification.show(`Created ${infoText}`))
                        .catch(error => Notification.show(`Failed to create ${infoText}`, "error"));
                }
            });
        }
    }

    protected onClickRename()
    {
        const assets = this.mediaManager.selectedAssets;
        if (assets.length === 1) {
            const asset = assets[0];
            MessageBox.show("Rename Asset", "New name:", "prompt", "ok-cancel", asset.info.name).then(result => {
                if (result.ok && result.text) {
                    const infoText = `asset '${asset.info.path}' to '${result.text}.'`;
                    this.mediaManager.rename(asset, result.text)
                        .then(() => Notification.show(`Renamed ${infoText}`))
                        .catch(error => Notification.show(`Failed to rename ${infoText}`, "error"));
                }
            });
        }
    }

    protected onClickDelete()
    {
        MessageBox.show("Delete Assets", "Are you sure?", "warning", "ok-cancel").then(result => {
            if (result.ok) {
                this.mediaManager.deleteSelected()
                    .then(() => Notification.show("Deleted selected assets."))
                    .catch(() => Notification.show("Failed to delete selected assets.", "error"));
            }
        });
    }

    protected onClickRefresh()
    {
        this.mediaManager.refresh();
    }
}