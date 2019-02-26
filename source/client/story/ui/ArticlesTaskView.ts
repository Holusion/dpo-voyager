/**
 * 3D Foundation Project
 * Copyright 2018 Smithsonian Institution
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

import { customElement, html } from "@ff/ui/CustomElement";

import "./ArticleList";
import { ISelectArticleEvent } from "./ArticleList";

import CVArticlesTask from "../components/CVArticlesTask";
import TaskView from "./TaskView";

////////////////////////////////////////////////////////////////////////////////

@customElement("sv-articles-task-view")
export default class ArticlesTaskView extends TaskView
{
    protected task: CVArticlesTask;

    protected render()
    {
        const articles = this.task.activeArticles;

        if (!articles) {
            return html`<div class="sv-placeholder">Please select an item to edit its articles</div>`;
        }

        const articleList = articles.getArticles();
        const article = this.task.activeArticle;

        const detailView = article ? html`` : null;

        return html`<div class="sv-commands">
            <ff-button text="Create" icon="create" @click=${this.onClickCreate}></ff-button>       
            <ff-button text="Delete" icon="trash" ?disabled=${!article} @click=${this.onClickDelete}></ff-button>  
        </div>
        <div class="ff-flex-item-stretch">
            <div class="ff-flex-column ff-fullsize">
                <sv-article-list .data=${articleList} .selectedItem=${article} @select=${this.onSelectDocument}></sv-article-list>
            </div>
            <ff-splitter direction="vertical"></ff-splitter>
            <div class="sv-panel-section sv-dialog sv-scrollable">
                ${detailView}
            </div>
        </div>`
    }

    protected onClickCreate()
    {

    }

    protected onClickDelete()
    {

    }

    protected onSelectDocument(event: ISelectArticleEvent)
    {
        if (this.task.activeArticles) {
            this.task.activeArticle = event.detail.article;
        }
    }
}