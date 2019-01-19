import { Inject, Injectable } from '@nestjs/common';

import { intersection, orderBy } from 'lodash';
import * as moment from 'moment';
import { from, Observable } from 'rxjs';
import { filter, map, mergeMap, reduce } from 'rxjs/operators';
import { Repository, FindConditions } from 'typeorm';

import { RepositoryToken } from '../../shared/config/config.enum';
import { ConfigService } from '../../shared/config/config.service';
import { ArticleDto, ArticleSearchDto, ArticleSeriesDto, ArticleUpdateDto } from '../dto/article.dto';
import { ArticleEntity } from '../entity/article.entity';
import { ArticleStatisticsEntity } from '../entity/article.statistics.entity';
import {
    ArticleStatistics,
    ArticleUpdateResult,
    ArticleOverview,
    ArticleSeriesOverview,
    ArticleDeleteResult,
} from '../interface/article.interface';

@Injectable()
export class ArticleService {
    constructor(
        @Inject(RepositoryToken.ArticleRepositoryToken) private readonly articleRepository: Repository<ArticleEntity>,
        @Inject(RepositoryToken.ArticleStatisticsRepositoryToken)
        private readonly statisticsRepository: Repository<ArticleStatisticsEntity>,
        private readonly configService: ConfigService,
    ) {}

    /**
     * !不知道SQl怎么写，用了下RX；
     */
    findArticles(arg: Partial<ArticleSearchDto>): Observable<ArticleEntity[] | ArticleOverview[]> {
        const { offset, limit, author, title, category, isOverview, rank, allState = false, userId } = arg;
        const conditionBase = {
            order: { createdAt: 'DESC' },
            take: limit || 1000,
            skip: offset || 0,
            relations: ['statistics', 'user'],
            where: { isDeleted: false },
        } as FindConditions<ArticleEntity>;
        const condition = allState
            ? conditionBase
            : ({ ...conditionBase, where: { isPublished: true, isDeleted: false } } as FindConditions<ArticleEntity>);

        return from(this.articleRepository.find(condition)).pipe(
            mergeMap(list =>
                from(list).pipe(
                    filter(article => (author ? article.author.includes(author) : true)),
                    filter(article => (title ? article.title.includes(title) : true)),
                    filter(article => (userId ? article.userId === userId : true)),
                    filter(article => (category ? !!intersection(category, article.category).length : true)),
                    reduce((acc: ArticleEntity[], cur: ArticleEntity) => [...acc, cur], []),
                    map(articles => (isOverview ? articles.map(item => this.getOverview(item)) : articles)),
                    map(
                        articles =>
                            rank
                                ? (orderBy(articles, [`statistics.${rank}`], ['desc']) as ArticleOverview[])
                                : articles,
                    ),
                ),
            ),
        );
    }

    /**
     * ! 用sql怎么查？
     */
    getSeriesOverview(data: ArticleSeriesDto): Observable<ArticleSeriesOverview> {
        return from(this.articleRepository.find({ where: { isPublished: true } })).pipe(
            map(result => result.filter(item => item.category.includes(data.series))),
            map(result => ({ total: result.length, original: result.filter(item => item.isOriginal).length })),
        );
    }

    private getOverview(article: ArticleEntity): ArticleOverview {
        const { id, createdAt, title, category, author, content, statistics, user, isPublished, thumbnail } = article;
        const contentExceptImage = content.replace(/\!\[[\w\.\-\_]*\]\(.*\)/g, '');

        return {
            id,
            createdAt,
            title,
            author,
            statistics,
            summary: contentExceptImage.slice(0, 100),
            category: Array.isArray(category) ? category : JSON.parse(category),
            avatar: user.avatar,
            isPublished,
            thumbnail,
        };
    }

    /**
     * 通过id查找指定的文章，返回的结果包括此文章的统计字段；
     * 递增文章被查询的次数。递增操作在查询操作之后，因此返回结果的查看次数比实际结果小 1
     * @param articleId 文章id
     */
    async findArticleById(articleId: number): Promise<ArticleEntity> {
        const result = await this.articleRepository.findOne({ id: articleId }, { relations: ['statistics'] });
        const { id } = result.statistics;

        this.statisticsRepository.increment({ id }, 'view', 1);

        return result;
    }

    /**
     * 保存文章并且初始化统计信息
     * @param data 前端传入的文章信息
     * @returns 文章的id
     */
    createArticle(data: ArticleDto): Observable<number> {
        const statistics = this.statisticsRepository.create();
        const { category, content, title, subtitle, author } = data;
        const article = this.articleRepository.create({
            ...data,
            title: title.trim(),
            subtitle: subtitle.trim(),
            author: author.trim(),
            category: JSON.stringify(category),
            createdAt: moment().format(this.configService.dateFormat),
            statistics,
        });

        return from(this.articleRepository.save(article)).pipe(map(result => result.id));
    }

    async updateArticle(data: ArticleUpdateDto): Promise<ArticleUpdateResult> {
        const { id, content, isPublish = true } = data;
        const state = { isPublished: isPublish, updatedAt: moment().format(this.configService.dateFormat) };

        return this.articleRepository
            .update(id, !!content ? { ...state, content} : state)
            .then(res => ({ isUpdated: !!res }));
    }

    async deleteArticle(id: number): Promise<ArticleDeleteResult> {
        return this.articleRepository.update(id, { isDeleted: true }).then(res => ({ isDeleted: !!res }));
    }

    // ================================================Article statistics==================================================

    async getStatisticsById(id: number): Promise<ArticleStatisticsEntity> {
        return this.statisticsRepository.findOne({ id });
    }

    async updateStatistics(data: Partial<ArticleStatistics>): Promise<Partial<ArticleStatistics>> {
        const { id, enjoy, stored } = data;
        const statistics = await this.statisticsRepository.findOne({ id });

        if (enjoy) {
            statistics.enjoy += enjoy;
        }

        if (stored) {
            statistics.stored += stored;
        }

        return this.statisticsRepository.save(statistics);
    }
}
