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

import filenamify from "filenamify";

import { Node, types } from "@ff/graph/Component";

import MessageBox from "@ff/ui/MessageBox";

import Article from "../models/Article";

import CVDocument from "./CVDocument";
import CVReader from "./CVReader";
import CVMeta from "./CVMeta";
import CVTask from "./CVTask";

import ArticlesTaskView from "../ui/story/ArticlesTaskView";
import CVMediaManager, { IAssetRenameEvent } from "./CVMediaManager";
import CVAssetWriter from "./CVAssetWriter";
import { ELanguageStringType, ELanguageType, DEFAULT_LANGUAGE } from "client/schema/common";
import CVStandaloneFileManager from "./CVStandaloneFileManager";
import CVAnnotationView from "./CVAnnotationView";

////////////////////////////////////////////////////////////////////////////////

export default class CVArticlesTask extends CVTask
{
    static readonly typeName: string = "CVArticlesTask";

    static readonly text: string = "Articles";
    static readonly icon: string = "article";


    protected static readonly ins = {
        create: types.Event("Articles.Create"),
        edit: types.Event("Articles.Edit"),
        delete: types.Event("Articles.Delete"),
        moveArticleUp: types.Event("Articles.MoveUp"),
        moveArticleDown: types.Event("Articles.MoveDown"),
        title: types.String("Article.Title"),
        lead: types.String("Article.Lead"),
        tags: types.Tags("Article.Tags"),
        uri: types.String("Article.URI"),
    };

    protected static readonly outs = {
        article: types.Object("Article", Article)
    };

    ins = this.addInputs<CVTask, typeof CVArticlesTask.ins>(CVArticlesTask.ins);
    outs = this.addOutputs<CVTask, typeof CVArticlesTask.outs>(CVArticlesTask.outs);

    reader: CVReader = null;
    private pendingArticles = new Set<string>();

    /**
     * All articles of the active document, regardless of the node they are attached to.
     */
    get articles(): Article[] {
        return this.reader ? this.reader.articles.map(entry => entry.article) : [];
    }
    get activeArticle() {
        return this.outs.article.value;
    }

    protected get mediaManager() {
        return this.getMainComponent(CVMediaManager);
    }
    protected get assetWriter() {
        return this.getMainComponent(CVAssetWriter);
    }

    constructor(node: Node, id: string)
    {
        super(node, id);

        const configuration = this.configuration;
        configuration.interfaceVisible = true;
        configuration.bracketsVisible = true;
        configuration.readerEnabled = true;
    }

    deactivateTask()
    {
        this.reader?.ins.articleId.setValue("");
        this.mediaManager.open(null); // close any open article
        super.deactivateTask();

    }

    update(context)
    {
        const ins = this.ins;
        const outs = this.outs;
        const activeArticle = this.activeArticle;

        if(!this.activeDocument) {
            return false;
        }
        const languageManager = this.activeDocument.setup.language;

        if (ins.create.changed) {
            const article = new Article();
            article.language = languageManager.ins.primarySceneLanguage.value;

            const defaultFolder = CVMediaManager.articleFolder;
            article.uri = `${defaultFolder}/new-article-${article.id}-${ELanguageType[article.language]}.html`;

            const standaloneFiles = this.getGraphComponent(CVStandaloneFileManager, true);
            if(standaloneFiles) {
                standaloneFiles.addFile(article.uri);
            }

            this.createEditArticle(article);

            // new articles are always attached to the scene node
            this.activeDocument.root.meta.articles.append(article);
            this.reader.outs.count.setValue(this.articles.length);
            // Selection follows the completed write, so the editor can read the new file.
            outs.article.set();
            languageManager.ins.activeLanguage.setValue(languageManager.ins.primarySceneLanguage.value);
        }
        else {
            if (activeArticle) {
                if (ins.uri.changed) {
                    activeArticle.uri = ins.uri.value;
                    this.reader.ins.refresh.set();

                    ins.edit.set();
                }

                if (ins.edit.changed && activeArticle.uri && !this.pendingArticles.has(activeArticle.uri)) {
                    this.mediaManager.open(activeArticle.uri);
                }
                if (ins.delete.changed) {
                    this.deleteArticle(activeArticle);
                    this.reader.outs.count.setValue(this.articles.length);
                }
                if (ins.title.changed) {
                    activeArticle.title = ins.title.value;
                    /*if (!activeAsset) {
                        const uri = this.getSafeArticlePath(ins.title.value + "-" + ELanguageType[ins.language.value]);
                        activeArticle.uri = uri;
                        ins.uri.setValue(uri, true);
                    }*/
                }
                if (ins.lead.changed || ins.tags.changed) {
                    activeArticle.lead = ins.lead.value;
                    activeArticle.tags = ins.tags.value.split(",").map(tag => tag.trim()).filter(tag => !!tag);
                }
                if (ins.moveArticleUp.changed) {
                    this.getArticleMeta(activeArticle)?.articles.moveItem(activeArticle, -1);
                    //return true;
                }
                if (ins.moveArticleDown.changed) {
                    this.getArticleMeta(activeArticle)?.articles.moveItem(activeArticle, 1);
                    //return true;
                }
            }
            else {
                if (ins.edit.changed) {
                    this.mediaManager.open(null);
                }
            }

            outs.article.set();
        }

        return true;
    }

    createView()
    {
        return new ArticlesTaskView(this);
    }

    /**
     * Returns the meta component the given article is attached to.
     */
    protected getArticleMeta(article: Article): CVMeta
    {
        return this.reader?.articles.find(entry => entry.article === article)?.node.meta || null;
    }

    protected deleteArticle(article: Article)
    {
        this.getArticleMeta(article)?.articles.removeItem(article);

        // Make sure we delete all language variation assets
        Object.values(ELanguageType).filter((v) => !isNaN(Number(v))).forEach( type => {
            article.language = type as ELanguageType;
            const asset = this.mediaManager.getAssetByPath(article.uri);
            if (asset) {
                this.mediaManager.delete(asset);
            }
        })
        
        // check for article ids in annotations
        const views = this.system.getComponents(CVAnnotationView); 
        views.forEach(component => {
            component.getAnnotations().forEach(annotation => {
                if(annotation.data.articleId === article.id) {
                    annotation.set("articleId", "");
                    component.updateAnnotation(annotation);
                }
            });
        });
    }

    protected createEditArticle(article: Article, uri = article.uri)
    {
        const language = article.language;
        const reader = this.reader;
        this.pendingArticles.add(uri);

        this.assetWriter.putText(`<h1>${article.title}</h1>`, uri)
        .then(() => this.mediaManager.refresh())
        .then(() => {
            // Publish a translated URI only after its file exists, so the viewport reader can load it too.
            article.data.uris[ELanguageType[language]] = uri;
            article.update();
            this.pendingArticles.delete(uri);
            if (this.isActiveTask && this.reader === reader && article.language === language) {
                reader.ins.articleId.setValue(article.id);
            }
        })
        .catch(error => {
            this.pendingArticles.delete(uri);
            MessageBox.show("Error", `Failed to create article at '${uri}'`, "error");
        });
    }

    protected getSafeArticlePath(title: string)
    {
        if (!title) {
            return "";
        }

        const path = filenamify(title, { replacement: "-" }).replace(/\s/g, "-").toLowerCase();
        const defaultFolder = CVMediaManager.articleFolder;

        return defaultFolder + "/" + path + ".html";
    }

    protected onActiveDocument(previous: CVDocument, next: CVDocument)
    {
        super.onActiveDocument(previous, next);
        if (previous) {
            previous.setup.language.outs.activeLanguage.off("value", this.onDocumentLanguageChange, this);
            this.mediaManager.off<IAssetRenameEvent>("asset-rename", this.onAssetRename, this);
            this.reader.outs.article.off("value", this.onArticleChange, this);
            this.reader = null;
        }
        if (next) {
            this.reader = next.setup.reader;
            this.reader.outs.article.on("value", this.onArticleChange, this);
            this.mediaManager.on<IAssetRenameEvent>("asset-rename", this.onAssetRename, this);
            next.setup.language.outs.activeLanguage.on("value", this.onDocumentLanguageChange, this);

            // update active article
            this.onArticleChange();
        }
    }

    protected onArticleChange()
    {
        const ins = this.ins;
        const outs = this.outs;
        const languageManager = this.activeDocument.setup.language;
        const activeArticle = this.reader.activeArticle;
        const article = activeArticle && this.articles.find(item => item.id === activeArticle.id);

        if (article) {
            ins.title.setValue(article.title, true);
            ins.lead.setValue(article.lead, true);
            ins.tags.setValue(article.tags.join(", "), true);

            // if we don't have a uri for this language, create one so that it is editable
            if(article.uri === undefined) {
                const defaultFolder = CVMediaManager.articleFolder;
                const uri = `${defaultFolder}/new-article-${article.id}-${languageManager.codeString()}.html`;
                if (!this.pendingArticles.has(uri)) {
                    this.createEditArticle(article, uri);
                }
            }
            else if (!this.pendingArticles.has(article.uri)) {
                this.ins.edit.set();
            }

            ins.uri.setValue(article.uri, true);
            outs.article.setValue(article);
        }
        else {
            ins.title.setValue("", true);
            ins.lead.setValue("", true);
            ins.tags.setValue("", true);
            ins.uri.setValue("", true);
            outs.article.setValue(null);
            ins.edit.set();
        }
    }

    protected onDocumentLanguageChange()
    {
        const article = this.activeArticle;
        const {ins} = this;

        this.onArticleChange();
    }


    // Handle potential media manager name change
    protected onAssetRename(event: IAssetRenameEvent) {
        this.onArticleChange();
    }
}