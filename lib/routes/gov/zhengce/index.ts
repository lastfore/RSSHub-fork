import { load } from 'cheerio';

import type { DataItem, Language, Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

export const route: Route = {
    path: '/:category{.+}?',
    categories: ['government'],
    example: '/gov/zhengce',
    parameters: { category: '分类，见下表，默认为最新' },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    radar: [
        {
            source: ['www.gov.cn/zhengce/*category'],
            target: '/:category',
        },
    ],
    name: '政策',
    maintainers: ['nczitzk'],
    handler,
    url: 'www.gov.cn/zhengce/',
    description: `最新政策（zuixin）列表来自 ZUIXINZHENGCE.json，页面 HTML 仅作兜底。

| 最新政策 | 政策解读 | 图解政策    |
| -------- | -------- | ----------- |
| zuixin   | jiedu    | jiedu/tujie |`,
};

const policyLinkPattern = /https?:\/\/www\.gov\.cn\/zhengce(?:\/[^/]+)*\/content_\d+\.htm/;

type ZuixinPolicyEntry = {
    TITLE: string;
    URL: string;
    DOCRELPUBTIME?: string;
};

const loadZuixinItemsFromJson = async (currentUrl: string, limit: number): Promise<DataItem[]> => {
    const jsonUrl = new URL('ZUIXINZHENGCE.json', currentUrl).href;
    const { data } = await got(jsonUrl);

    if (!Array.isArray(data)) {
        return [];
    }

    return (data as ZuixinPolicyEntry[])
        .filter((entry) => entry.URL && entry.TITLE)
        .slice(0, limit)
        .map((entry) => ({
            title: entry.TITLE,
            link: entry.URL,
            ...(entry.DOCRELPUBTIME && {
                pubDate: timezone(parseDate(entry.DOCRELPUBTIME, 'YYYY-MM-DD'), 8),
            }),
        }));
};

const loadItemsFromHtml = ($: ReturnType<typeof load>, currentUrl: string) =>
    $('h4 a, div.subtitle a[title]')
        .toArray()
        .map((item): DataItem => {
            const $item = $(item);

            const link = $item.prop('href');

            return {
                title: $item.text(),
                link: link!.startsWith('http') ? link : new URL(link!, currentUrl).href,
            };
        })
        .filter((item) => policyLinkPattern.test(item.link!));

export async function handler(ctx) {
    const { category = 'zuixin' } = ctx.req.param();
    const limit = ctx.req.query('limit') ? Number(ctx.req.query('limit')) : 20;

    const rootUrl = 'https://www.gov.cn';
    const normalizedCategory = category.replace(/\/$/, '');
    const currentUrl = new URL(`zhengce/${normalizedCategory}/`, rootUrl).href;

    let items: DataItem[] = [];

    if (normalizedCategory === 'zuixin') {
        try {
            items = await loadZuixinItemsFromJson(currentUrl, limit);
        } catch {
            // Fall back to HTML when the JSON feed is unavailable.
        }
    }

    let $: ReturnType<typeof load>;

    try {
        const { data: response } = await got(currentUrl);
        $ = load(response);
    } catch (error) {
        if (items.length === 0) {
            throw error;
        }
        $ = load('<html><head><title>最新政策_政策_中国政府网</title></head></html>');
    }

    if (items.length === 0) {
        items = loadItemsFromHtml($, currentUrl);
    }

    items = await Promise.all(
        items
            .slice(0, limit)
            .map((item) =>
                cache.tryGet(item.link!, async () => {
                    const { data: detailResponse } = await got(item.link);

                    const content = load(detailResponse);

                    const processElementText = (el) => content(el).text().split(/：/).pop()!.trim() || content(el).next().text().trim();

                    const author = content('meta[name="author"]').prop('content');

                    const agencyEl = content('table.bd1')
                        .find('td')
                        .toArray()
                        .findLast((a) => content(a).text().startsWith('发文机关'));

                    const sourceEl = content('span.font-zyygwj')
                        .toArray()
                        .findLast((a) => content(a).text().startsWith('来源'));

                    const subjectEl = content('table.bd1')
                        .find('td')
                        .toArray()
                        .findLast((a) => content(a).text().startsWith('主题分类'));

                    const agency = agencyEl ? processElementText(agencyEl) : undefined;
                    const source = sourceEl ? processElementText(sourceEl) : undefined;
                    const subject = subjectEl ? processElementText(subjectEl) : content('td.zcwj_ztfl').text();

                    const column = content('meta[name="lanmu"]').prop('content');
                    const keywords = content('meta[name="keywords"]').prop('content')?.split(/;|,/) ?? [];
                    const manuscriptId = content('meta[name="manuscriptId"]').prop('content');

                    item.title = content('div.share-title').text() || item.title;
                    item.description = content('div.TRS_UEDITOR').first().html() || content('div#UCAP-CONTENT, td#UCAP-CONTENT').first().html();
                    item.author = [agency, source, author].filter(Boolean).join('/');
                    item.category = [...new Set([subject, column, ...keywords].filter(Boolean))];
                    item.guid = `gov-zhengce-${manuscriptId}`;
                    const detailPubDate = content('meta[name="firstpublishedtime"]').prop('content');
                    item.pubDate = detailPubDate
                        ? timezone(parseDate(detailPubDate, 'YYYY-MM-DD-HH:mm:ss'), 8)
                        : item.pubDate;
                    item.updated = timezone(parseDate(content('meta[name="lastmodifiedtime"]').prop('content'), 'YYYY-MM-DD-HH:mm:ss'), 8);

                    return item;
                })
            )
    );

    const imageSrc = $('img.wordlogo').prop('src');
    const iconHref = $('link[rel="icon"]').prop('href');
    const image = imageSrc ? new URL(imageSrc, rootUrl).href : undefined;
    const icon = iconHref ? new URL(iconHref, rootUrl).href : undefined;
    const subtitle = $('meta[name="lanmu"]').prop('content');
    const author = $('div.header_logo a[aria-label]').prop('aria-label');

    return {
        item: items,
        title: author && subtitle ? `${author} - ${subtitle}` : $('title').text(),
        link: currentUrl,
        description: $('meta[name="description"]').prop('content'),
        language: 'zh-CN' as const satisfies Language,
        image,
        icon,
        logo: icon,
        subtitle,
        author,
    };
}
