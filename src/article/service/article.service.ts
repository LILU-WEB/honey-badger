import { Inject, Injectable } from '@nestjs/common';

import { intersection } from 'lodash';
import * as moment from 'moment';
import { from, Observable } from 'rxjs';
import { filter, map, mergeMap, reduce } from 'rxjs/operators';
import { Repository } from 'typeorm';

import { RepositoryToken } from '../../shared/config/config.provider';
import { ConfigService } from '../../shared/config/config.service';
import { ArticleDto, ArticleSearchDto } from '../dto/article.dto';
import { ArticleEntity } from '../entity/article.entity';
import { ArticleStatisticsEntity } from '../entity/article.statistics.entity';
import { ArticleStatistics, ArticleUpdate } from '../interface/article.interface';

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
    findArticles(arg: ArticleSearchDto): Observable<ArticleEntity[]> {
        const { offset, limit, author, title, category } = arg;

        return from(
            this.articleRepository.find({
                order: { createdAt: 'DESC' },
                take: limit || 100,
                skip: offset || 0,
                where: { isPublished: true },
            }),
        ).pipe(
            mergeMap(list =>
                from(list).pipe(
                    filter(article => (author ? article.author.includes(author) : true)),
                    filter(article => (title ? article.title.includes(title) : true)),
                    filter(article => (category ? !!intersection(category, article.category).length : true)),
                    reduce((acc: ArticleEntity[], cur: ArticleEntity) => [...acc, cur], []),
                ),
            ),
        );
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
        const { category } = data;
        const article = this.articleRepository.create({
            ...data,
            category: JSON.stringify(category),
            createdAt: moment().format(this.configService.dateFormat),
            statistics,
        });

        return from(this.articleRepository.save(article)).pipe(map(result => result.id));
    }

    async updateArticle(data: ArticleUpdate): Promise<boolean> {
        const { id, content } = data;

        return this.articleRepository
            .update(id, { content, updatedAt: moment().format(this.configService.dateFormat) })
            .then(res => !!res);
    }

    async deleteArticle(id: number): Promise<boolean> {
        return this.articleRepository.update(id, { isDeleted: true }).then(res => !!res);
    }

    // ================================================Article statistics==================================================

    async getStatisticsById(id: number): Promise<ArticleStatisticsEntity> {
        return this.statisticsRepository.findOne({ id });
    }

    async updateStatistics(data: Partial<ArticleStatistics>): Promise<boolean> {
        return this.statisticsRepository.save(data).then(res => !!res);
    }
}
