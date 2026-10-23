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

/* Import TinyMCE */
import tinymce, { Editor } from 'tinymce';

/* Default icons are required for TinyMCE 5.3 or above */
import 'tinymce/icons/default';

/* A theme is also required */
import 'tinymce/themes/silver';

import 'tinymce/models/dom/model';

/* Import the skin */
import './editor_css/skin.min.css';

/* Import plugins */
import 'tinymce/plugins/link';
import 'tinymce/plugins/lists';
import 'tinymce/plugins/image';
import 'tinymce/plugins/media';

/* Import content css */
import contentUiCss from './editor_css/content.ui.min.css?raw';
import contentCss from './editor_css/content.min.css?raw';
import contentOverrides from './editor_css/overrides.css?raw';

import Notification from "@ff/ui/Notification";
import MessageBox from "@ff/ui/MessageBox";

import SystemView, { customElement } from "@ff/scene/ui/SystemView";

import CVAssetManager from "../../components/CVAssetManager";
import CVAssetReader from "../../components/CVAssetReader";
import CVAssetWriter from "../../components/CVAssetWriter";

import CVMediaManager, { IAssetOpenEvent, IAssetRenameEvent } from "../../components/CVMediaManager";
import CVStandaloneFileManager from "../../components/CVStandaloneFileManager";
import CVReader from "../../components/CVReader";


////////////////////////////////////////////////////////////////////////////////

@customElement("sv-article-editor")
export default class ArticleEditor extends SystemView
{
    static readonly changeEvent = "sv-article-editor-change";

    private _container: HTMLDivElement = null;
    private _overlay: HTMLElement = null;
    private _assetPath: string = "";
    private _editor: Editor = null;
    private _ready: Promise<void>;
    private _pending: Promise<unknown> = Promise.resolve();

    get hasArticle() {
        return !!this._assetPath;
    }

    protected get mediaManager() {
        return this.system.getMainComponent(CVMediaManager);
    }
    protected get assetManager() {
        return this.system.getMainComponent(CVAssetManager);
    }
    protected get assetReader() {
        return this.system.getMainComponent(CVAssetReader);
    }
    protected get assetWriter() {
        return this.system.getMainComponent(CVAssetWriter);
    }
    protected get standaloneFileManager() {
        return this.system.getMainComponent(CVStandaloneFileManager, true);
    }
    protected get articleReader() {
        return this.system.getComponent(CVReader);
    }

    /** Runs editor actions in order, once TinyMCE is ready. */
    private enqueue(action: () => Promise<unknown>)
    {
        const next = this._pending.then(() => this._ready).then(action);
        this._pending = next.catch(error => {
            new Notification(`Article editor: ${error.message}`, "error");
        });
        return this._pending;
    }

    openArticle(assetPath: string)
    {
        return this.enqueue(async () => {
            if (this._assetPath === assetPath) {
                return;
            }
            if (this._assetPath) {
                await this.confirmCloseArticle();
            }
            await this.readArticle(assetPath);
        });
    }

    saveArticle()
    {
        return this.enqueue(async () => {
            if (this._assetPath) {
                await this.writeArticle();
            }
        });
    }

    closeArticle()
    {
        return this.enqueue(() => this.confirmCloseArticle());
    }

    private async confirmCloseArticle()
    {
        if (this._editor.isDirty() && this._assetPath) {
            const result = await MessageBox.show("Close Article", "Would you like to save your changes?", "warning", "yes-no");
            if (result.ok) {
                await this.writeArticle();
            }
        }
        await this.clearArticle();
    }

    protected readArticle(assetPath: string)
    {
        return this.assetReader.getText(assetPath)
        .then(content => this.parseArticle(content, assetPath))
        .catch(e=>{
            return `
                <h2>Article not found at ${assetPath}</h2>
                <p>
                    ${e}
                </p>
            `;
        })
        .then(content => {
            this._editor.setContent(content, {format: "raw"});
            this._assetPath = assetPath;
        }).then(() => {
            this._editor.setDirty(false);
            if(this._overlay.parentElement === this) {
                this.removeChild(this._overlay);
            }
            this.dispatchEvent(new CustomEvent(ArticleEditor.changeEvent, { bubbles: true }));
        });
    }

    protected parseArticle(content: string, articlePath: string): Promise<string>
    {
        // remove line breaks
        content = content.replace(/[\n\r]/g, "");

        // transform article-relative to absolute URLs
        const articleBasePath = this.assetManager.getAssetBasePath(articlePath);

        content = content.replace(/(src=\")(.*?)(\")/g, (match, pre, assetUrl, post) => {
            if (!assetUrl.startsWith("/") && !assetUrl.startsWith("http")) {
                assetUrl = this.assetManager.getAssetUrl(articleBasePath + assetUrl);
            }
            return pre + assetUrl + post;
        });

        return Promise.resolve(content);
    }

    protected writeArticle()
    {
        const basePath = this.assetManager.getAssetBasePath(this._assetPath);

        let content = this._editor.getContent({format: "raw"});

        // transform absolute to article-relative URLs
        content = content.replace(/(src=\")(.*?)(\")/g, (match, pre, assetUrl, post) => {
            if((assetUrl as string).startsWith("blob")) {
                assetUrl = this.standaloneFileManager.blobUrlToFileUrl(assetUrl);
                assetUrl = assetUrl.replace(CVMediaManager.articleFolder + "/", '');
                return pre + assetUrl + post;
            }

            return pre + this.assetManager.getRelativeAssetPath(assetUrl, basePath) + post;
        });

        return this.assetWriter.putText(content, this._assetPath)
            .then(() => {
                this._editor.setDirty(false);
                this.articleReader.ins.articleId.set();
                new Notification(`Article successfully written to '${this._assetPath}'`, "info");
            })
            .catch(error => {
                throw new Error(`Failed to write article to '${this._assetPath}': ${error.message}`);
            });
    }

    protected clearArticle()
    {
        this._editor.setContent("");
        this._assetPath = "";
        this._editor.setDirty(false);

        this.appendChild(this._overlay);
        this.dispatchEvent(new CustomEvent(ArticleEditor.changeEvent, { bubbles: true }));

        return Promise.resolve();
    }

    

    protected firstConnected()
    {
        super.firstConnected();
        this.classList.add("sv-article-editor");

        this._container = this.appendElement("div");
        this._container.classList.add("sv-container");

        this._overlay = this.appendElement("div");
        this._overlay.classList.add("sv-overlay");
    }

    protected connected()
    {
        super.connected();
        this.mediaManager.on<IAssetOpenEvent>("asset-open", this.onOpenAsset, this);
        this.mediaManager.on<IAssetRenameEvent>("asset-rename", this.onRenameAsset, this);

        this._ready = tinymce.init({
            target: this._container,
            plugins: "image link lists media",
            toolbar: 'saveButton closeButton | undo redo | link image media | bold italic | alignleft aligncenter alignright alignjustify | bullist numlist | outdent indent | styles',
            menubar: false,
            skin: false,
            height: "100%",
            resize: false,
            branding: false,
            automatic_uploads: true,
            images_reuse_filename: true,
            link_assume_external_targets: 'https',
            paste_as_text: true,
            content_css: false,
            font_css: this.assetReader.getSystemAssetUrl("fonts/fonts.css"),
            content_style: [contentCss, contentUiCss, contentOverrides].join('\n'),
            convert_urls: false,
            image_caption: true,
            link_default_target: '_blank',
            //link_target_list: false,

            images_upload_handler: (file, progress) => new Promise((resolve, reject) => {
                const filename = this.mediaManager.getUniqueName(CVMediaManager.articleFolder + "/" + file.filename());
                const fullPath = CVMediaManager.articleFolder + "/" + filename;
                this.mediaManager.uploadFile(fullPath, file.blob()).
                    then( () => { resolve(this.assetManager.getAssetUrl(fullPath))});
            }),

            init_instance_callback: (editor) => {
                editor.editorUpload.addFilter((img) => {
                    const blobInfo = editor.editorUpload.blobCache.getByUri(img.src);
                    if(blobInfo) {
                        if(this.standaloneFileManager) {
                            const filename = this.mediaManager.getUniqueName(CVMediaManager.articleFolder + "/" + blobInfo.filename());
                            const fullPath = CVMediaManager.articleFolder + "/" + filename;
                            this.mediaManager.uploadFile(fullPath, blobInfo.blob())
                            img.src = this.assetManager.getAssetUrl(fullPath);
                        }
                        else {
                            return true;
                        }
                    }
                    return false;
                });
            },

            setup: (editor) => {
                editor.ui.registry.addButton('saveButton', {
                    text: 'Save',
                    icon: 'save',
                    onAction: (_) => {
                        this.saveArticle();
                    }
                });

                editor.ui.registry.addButton('closeButton', {
                    text: 'Close',
                    icon: 'close',
                    onAction: (_) => {
                        this.closeArticle();
                    }
                });

                /*editor.on('init', function(args) {
                    editor = args.target;
            
                    editor.on('NodeChange', function(e) {
                        if (e && e.element.nodeName.toLowerCase() == 'img') {
                            tinymce.DOM.setAttribs(e.element, {'height': "100%", 'max-width': "100%"});
                        }
                    });
                });*/
            },
        }).then(editors => { this._editor = editors[0]; });
    }

    protected disconnected()
    {
        this.mediaManager.off<IAssetRenameEvent>("asset-rename", this.onRenameAsset, this);
        this.mediaManager.off<IAssetOpenEvent>("asset-open", this.onOpenAsset, this);

        this._ready.then(() => this._editor.remove());
        super.disconnected();
    }

    protected onOpenAsset(event: IAssetOpenEvent)
    {
        // if there is no asset, close any current article
        if(event.asset === null ) {
            this.closeArticle();
        }
        // if opened asset is of type text/*, open it in the editor
        else if (event.asset.info.type.startsWith("text/")) {
            this.openArticle(event.asset.info.path);
        }
    }

    protected onRenameAsset(event: IAssetRenameEvent)
    {
        // update asset path
        if(event.oldPath === this._assetPath ) {
            this._assetPath = event.newPath;
        }
    }
}