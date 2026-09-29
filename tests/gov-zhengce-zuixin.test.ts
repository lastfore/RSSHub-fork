import type { Context } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handler } from '../lib/routes/gov/zhengce/index';
import type { Data } from '../lib/types';

const mocks = vi.hoisted(() => ({ request: vi.fn(), tryGet: vi.fn() }));
vi.mock('../lib/utils/got', () => ({ default: mocks.request }));
vi.mock('../lib/utils/cache', () => ({ default: { tryGet: mocks.tryGet } }));

const invoke = async (path = '/gov/zhengce/zuixin') =>
    (await handler({ req: { path, query: vi.fn(), param: (name?: string) => (name === 'category' ? 'zuixin' : undefined) } } as unknown as Context)) as Data;

beforeEach(() => {
    vi.resetAllMocks();
    mocks.tryGet.mockImplementation(async (_key, callback) => await callback());
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('gov/zhengce/zuixin', () => {
    it('loads the list from ZUIXINZHENGCE.json when the HTML shell has no items', async () => {
        const json = [
            {
                TITLE: '中华人民共和国审计法实施条例',
                URL: 'https://www.gov.cn/zhengce/content/202609/content_7081972.htm',
                DOCRELPUBTIME: '2026-09-24',
            },
        ];
        const listHtml = `<html><head><title>最新政策_政策_中国政府网</title><meta name="lanmu" content="最新政策"></head><body><ul id="list-1-ajax-id"></ul></body></html>`;
        const detailHtml =
            '<html><head><meta name="firstpublishedtime" content="2026-09-24-10:00:00"></head><body><div class="share-title">中华人民共和国审计法实施条例</div><div id="UCAP-CONTENT"><p>正文</p></div></body></html>';

        mocks.request.mockImplementation(async (url: string) => {
            if (url.endsWith('ZUIXINZHENGCE.json')) {
                return { data: json };
            }
            if (url.endsWith('/zhengce/zuixin/')) {
                return { data: listHtml };
            }
            if (url.includes('content_7081972.htm')) {
                return { data: detailHtml };
            }
            throw new Error(`Unexpected upstream request: ${url}`);
        });

        const result = await invoke();

        expect(result.item).toHaveLength(1);
        expect(result.item[0].title).toBe('中华人民共和国审计法实施条例');
        expect(result.item[0].link).toBe(json[0].URL);
    });
});
