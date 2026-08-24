import { describe, expect, test } from "bun:test";

import { buildRequest } from "../provider-adapter";
import { inferModelInfo } from "../model-inference";
import { getModelLogoById } from "../model-logo";
import { fetchProApiTokenUsage, proApiRootUrl, summarizeModelCategories } from "../proapi-usage";
import { mergeSuggestedModelOptions, modelOptionLabel, modelOptionSearchText, modelOptionsFromChannels, normalizeModelOptionValue, resolveModelRequestConfig, type AiConfig } from "../../../stores/use-config-store";
import { clampImageSize, resolveModelRequestSize } from "../../../services/api/image";

describe("pro-spec inference", () => {
    test("infers OpenAI chat model", () => {
        const info = inferModelInfo("gpt-4o");
        expect(info.category).toBe("chat");
        expect(info.group).toBe("OpenAI");
        expect(info.apiFormat).toBe("openai-response");
    });

    test("infers Grok image model", () => {
        const info = inferModelInfo("grok-imagine");
        expect(info.category).toBe("image");
        expect(info.group).toBe("xAI");
        expect(info.apiFormat).toBe("dalle");
    });

    test("infers Grok video models", () => {
        const openaiVideo = inferModelInfo("grok-imagine-video");
        expect(openaiVideo.category).toBe("video");
        expect(openaiVideo.group).toBe("xAI");
        expect(openaiVideo.apiFormat).toBe("openai-video");

        // grok-image-video：部分聚合商把图生视频模型命名为 image 而非 imagine，
        // 不能被宽泛的 /image/ 规则误判为图像（否则视频节点下拉框为空 → 误弹配置框）
        const imageVideo = inferModelInfo("grok-image-video");
        expect(imageVideo.category).toBe("video");
        expect(imageVideo.group).toBe("xAI");
        expect(imageVideo.apiFormat).toBe("openai-video");

        const chatVideo = inferModelInfo("grok-video-chat");
        expect(chatVideo.category).toBe("video");
        expect(chatVideo.group).toBe("xAI");
        expect(chatVideo.apiFormat).toBe("grok-video-chat");
    });

    test("keeps image-specific models on dalle-compatible image protocol", () => {
        const geminiImage = inferModelInfo("gemini-2.5-flash-image");
        expect(geminiImage.category).toBe("image");
        expect(geminiImage.apiFormat).toBe("dalle");

        const soraImage = inferModelInfo("sora_image");
        expect(soraImage.category).toBe("image");
        expect(soraImage.apiFormat).toBe("dalle");

        const hunyuanImage = inferModelInfo("hunyuan-image-v3");
        expect(hunyuanImage.category).toBe("image");
        expect(hunyuanImage.apiFormat).toBe("dalle");
        expect(hunyuanImage.capabilities.length).toBe(0);

        for (const modelId of ["grok-imagine-image-edit", "qwen-image-edit", "flux-kontext-pro"]) {
            const info = inferModelInfo(modelId);
            expect(info.category).toBe("image");
            expect(info.apiFormat).toBe("dalle");
        }
    });

    test("resolves model logo", () => {
        expect(getModelLogoById("claude-sonnet-4-20250514")).toBe("/models/claude.png");
    });
});

describe("pro-spec provider adapter", () => {
    test("parses successful HTTP business errors", async () => {
        const request = buildRequest({
            modelId: "grok-imagine",
            prompt: "studio",
            baseUrl: "https://newapi.prorisehub.com",
            apiKey: "sk-test",
        });
        const parsed = await request.parseResponse(new Response(JSON.stringify({ code: 400, msg: "quota exhausted" }), { status: 200 }));
        expect(parsed.error).toBe("quota exhausted");
    });

    test("builds Hunyuan Image as images generation request instead of chat", () => {
        const request = buildRequest({
            modelId: "hunyuan-image-v3",
            prompt: "studio",
            modelParams: { size: "1024x1024", quality: "high" },
            baseUrl: "https://newapi.prorisehub.com",
            apiKey: "sk-test",
        });
        expect(request.url).toBe("https://newapi.prorisehub.com/v1/images/generations");
        expect(request.init.method).toBe("POST");
        const body = JSON.parse(String(request.init.body)) as Record<string, unknown>;
        expect(body.model).toBe("hunyuan-image-v3");
        expect(body.size).toBe("1024x1024");
        expect(body.quality).toBe("high");
    });

    test("builds Agnes Image without LiteLLM-unsupported response_format", () => {
        const request = buildRequest({
            modelId: "agnes-image-2.1-flash",
            prompt: "studio",
            modelParams: { size: "1024x1024", quality: "high" },
            baseUrl: "https://newapi.prorisehub.com",
            apiKey: "sk-test",
        });
        expect(request.url).toBe("https://newapi.prorisehub.com/v1/images/generations");
        expect(request.init.method).toBe("POST");
        const body = JSON.parse(String(request.init.body)) as Record<string, unknown>;
        expect(body.model).toBe("agnes-image-2.1-flash");
        expect(body.prompt).toBe("studio");
        expect(body.n).toBe(1);
        expect(body.response_format).toBeUndefined();
        expect(body.size).toBeUndefined();
        expect(body.quality).toBeUndefined();
    });

    test("parses URL-only image responses", async () => {
        const request = buildRequest({
            modelId: "agnes-image-2.1-flash",
            prompt: "studio",
            baseUrl: "https://newapi.prorisehub.com",
            apiKey: "sk-test",
        });
        const parsed = await request.parseResponse(new Response(JSON.stringify({ data: [{ url: "https://example.com/image.png" }] }), { status: 200 }));
        expect(parsed.resourceUrl).toBe("https://example.com/image.png");
        expect(parsed.resources?.[0]).toBe("https://example.com/image.png");
    });

    test("builds image edit requests through images edits multipart", () => {
        const request = buildRequest({
            operation: "edit",
            modelId: "qwen-image-edit",
            prompt: "edit this",
            imageFiles: [new File(["image"], "reference.png", { type: "image/png" })],
            modelParams: { size: "1024x1024", negativePrompt: "blur" },
            baseUrl: "https://newapi.prorisehub.com",
            apiKey: "sk-test",
        });
        expect(request.url).toBe("https://newapi.prorisehub.com/v1/images/edits");
        expect(request.init.method).toBe("POST");
        expect(request.init.body instanceof FormData).toBe(true);
        const form = request.init.body as FormData;
        expect(form.get("model")).toBe("qwen-image-edit");
        expect(form.get("prompt")).toBe("edit this");
        expect(form.get("size")).toBe("1024x1024");
        expect(form.get("negative_prompt")).toBe("blur");
        expect(form.getAll("image").length).toBe(1);
    });

    test("uses pixel size without duplicate aspect ratio for GPT Image ultrawide edits", () => {
        for (const [ratio, expectedSize] of [["21:9", "1552x672"], ["9:21", "672x1552"]] as const) {
            const size = resolveModelRequestSize("gpt-image-2", "1k", ratio);
            expect(size).toBe(expectedSize);
            const request = buildRequest({
                operation: "edit",
                modelId: "gpt-image-2",
                prompt: "preserve the full composition",
                imageFiles: [new File(["image"], "reference.png", { type: "image/png" })],
                modelParams: { size, aspectRatio: ratio },
                baseUrl: "https://newapi.prorisehub.com",
                apiKey: "sk-test",
            });
            const form = request.init.body as FormData;
            expect(form.get("size")).toBe(expectedSize);
            expect(form.has("aspect_ratio")).toBe(false);
        }
    });

    test("uses image[] array field when editing with multiple reference images", () => {
        const request = buildRequest({
            operation: "edit",
            modelId: "gpt-image-2",
            prompt: "merge these",
            imageFiles: [
                new File(["a"], "ref1.png", { type: "image/png" }),
                new File(["b"], "ref2.png", { type: "image/png" }),
            ],
            baseUrl: "https://newapi.prorisehub.com",
            apiKey: "sk-test",
        });
        const form = request.init.body as FormData;
        // 多图必须走 image[] 数组字段，否则 newapi 网关返回 422
        expect(form.getAll("image[]").length).toBe(2);
        expect(form.getAll("image").length).toBe(0);
    });

    test("rejects masks for non-mask image edit models", () => {
        let errorMessage = "";
        try {
            buildRequest({
                operation: "edit",
                modelId: "qwen-image-edit",
                prompt: "edit this",
                imageFiles: [new File(["image"], "reference.png", { type: "image/png" })],
                mask: new File(["mask"], "mask.png", { type: "image/png" }),
                baseUrl: "https://newapi.prorisehub.com",
                apiKey: "sk-test",
            });
        } catch (error) {
            errorMessage = error instanceof Error ? error.message : "";
        }
        expect(errorMessage.includes("暂不支持蒙版编辑")).toBe(true);
    });

    test("rejects local Grok video reference images in browser direct mode", () => {
        let errorMessage = "";
        try {
            buildRequest({
                modelId: "grok-imagine-video",
                prompt: "video",
                images: ["data:image/png;base64,abc"],
                baseUrl: "https://newapi.prorisehub.com",
                apiKey: "sk-test",
            });
        } catch (error) {
            errorMessage = error instanceof Error ? error.message : "";
        }
        expect(errorMessage.includes("Grok 视频参考图需要公网 URL")).toBe(true);
    });

    test("routes grok-image-video to the Grok video endpoint", () => {
        const request = buildRequest({
            modelId: "grok-image-video",
            prompt: "video",
            baseUrl: "https://newapi.prorisehub.com",
            apiKey: "sk-test",
        });
        expect(request.apiFormat).toBe("openai-video");
        expect(request.url).toBe("https://newapi.prorisehub.com/v1/videos");
        expect(request.init.method).toBe("POST");
        const form = request.init.body as FormData;
        expect(form.get("model")).toBe("grok-image-video");
    });
});

describe("pro-spec ProAPI usage", () => {
    test("normalizes ProAPI root URL", () => {
        expect(proApiRootUrl("https://newapi.prorisehub.com/v1")).toBe("https://newapi.prorisehub.com");
        expect(proApiRootUrl("https://newapi.prorisehub.com/")).toBe("https://newapi.prorisehub.com");
    });

    test("summarizes model categories", () => {
        const summary = summarizeModelCategories(["hunyuan-image-v3", "grok-imagine-video", "gpt-4o"]);
        expect(summary.total).toBe(3);
        expect(summary.image).toBe(1);
        expect(summary.video).toBe(1);
        expect(summary.chat).toBe(1);
    });

    test("fetches token usage with sk API key", async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async (url, init) => {
            expect(String(url)).toBe("/api/proapi/usage/token");
            expect(init?.method).toBe("POST");
            const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
            expect(body.baseUrl).toBe("https://newapi.prorisehub.com/v1");
            expect(body.apiKey).toBe("sk-test");
            return new Response(
                JSON.stringify({
                    success: true,
                    data: {
                        name: "agent-managed",
                        total_granted: 100,
                        total_used: 12.34,
                        total_available: 87.66,
                        unlimited_quota: false,
                        model_limits_enabled: true,
                        model_limits: ["hunyuan-image-v3"],
                        expires_at: -1,
                    },
                }),
                { status: 200 },
            );
        }) as typeof fetch;

        try {
            const usage = await fetchProApiTokenUsage({
                baseUrl: "https://newapi.prorisehub.com/v1",
                apiKey: "sk-test",
            });
            expect(usage.totalAvailable).toBe(87.66);
            expect(usage.modelLimitsEnabled).toBe(true);
            expect(usage.modelLimits.length).toBe(1);
            expect(usage.modelLimits[0]).toBe("hunyuan-image-v3");
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});

describe("model channel routing", () => {
    test("keeps same model names selectable across different API keys", () => {
        const channels = [
            { id: "key-a", name: "ProAPI A", baseUrl: "https://a.example.com", apiKey: "sk-channel-a", apiFormat: "openai" as const, models: ["gpt-4o"] },
            { id: "key-b", name: "ProAPI B", baseUrl: "https://b.example.com", apiKey: "sk-channel-b", apiFormat: "openai" as const, models: ["gpt-4o"] },
        ];
        const models = modelOptionsFromChannels(channels);
        const config = { channels, models, model: models[0], imageModel: "", videoModel: "", textModel: models[0], audioModel: "" } as AiConfig;

        expect(models.length).toBe(2);
        expect(models[0]).toBe("key-a::gpt-4o");
        expect(models[1]).toBe("key-b::gpt-4o");
        expect(modelOptionLabel(config, models[0])).toBe("gpt-4o（ProAPI A #1 · a.example.com · Key ...el-a）");
        expect(modelOptionLabel(config, models[1])).toBe("gpt-4o（ProAPI B #2 · b.example.com · Key ...el-b）");
        expect(modelOptionSearchText(config, models[1]).includes("b.example.com")).toBe(true);
        expect(modelOptionSearchText(config, models[1]).includes("el-b")).toBe(true);

        const first = resolveModelRequestConfig(config, models[0]);
        const second = resolveModelRequestConfig(config, models[1]);
        expect(first.apiKey).toBe("sk-channel-a");
        expect(second.apiKey).toBe("sk-channel-b");
        expect(first.baseUrl).toBe("https://a.example.com");
        expect(second.baseUrl).toBe("https://b.example.com");
        expect(first.model).toBe("gpt-4o");
        expect(second.model).toBe("gpt-4o");
    });

    test("normalizes legacy bare models without silently using a stale channel", () => {
        const channels = [
            { id: "key-a", name: "ProAPI A", baseUrl: "https://a.example.com", apiKey: "sk-channel-a", apiFormat: "openai" as const, models: ["claude-sonnet-4"] },
            { id: "key-b", name: "ProAPI B", baseUrl: "https://b.example.com", apiKey: "sk-channel-b", apiFormat: "openai" as const, models: ["gpt-4o"] },
        ];
        const models = modelOptionsFromChannels(channels);
        const config = { channels, models, model: models[1], imageModel: "", videoModel: "", textModel: models[1], audioModel: "" } as AiConfig;

        expect(normalizeModelOptionValue("gpt-4o", channels)).toBe("key-b::gpt-4o");
        expect(normalizeModelOptionValue("deleted::gpt-4o", channels)).toBe("key-b::gpt-4o");

        const legacyBare = resolveModelRequestConfig(config, "gpt-4o");
        const staleChannel = resolveModelRequestConfig(config, "deleted::gpt-4o");
        const emptyValue = resolveModelRequestConfig(config, "");
        expect(legacyBare.apiKey).toBe("sk-channel-b");
        expect(staleChannel.apiKey).toBe("sk-channel-b");
        expect(emptyValue.apiKey).toBe("sk-channel-b");
        expect(emptyValue.model).toBe("gpt-4o");
    });

    test("adds newly fetched same-name models into selectable options", () => {
        const current = ["high::gpt-image-2", "high::imagen-4"];
        const suggested = ["high::gpt-image-2", "medium::gpt-image-2", "medium::agnes-image-2.1-flash"];

        expect(mergeSuggestedModelOptions(current, suggested)).toEqual(["high::gpt-image-2", "high::imagen-4", "medium::gpt-image-2", "medium::agnes-image-2.1-flash"]);
    });
});

describe("clampImageSize", () => {
    const STEP = 16;
    const MIN = 655360;
    const MAX = 8294400;
    const EDGE = 3840;
    const RATIO = 3;
    const assertValid = (w: number, h: number) => {
        expect(Number.isInteger(w) && Number.isInteger(h)).toBe(true);
        expect(w % STEP === 0 && h % STEP === 0).toBe(true);
        expect(Math.max(w, h)).toBeLessThanOrEqual(EDGE);
        expect(Math.max(w, h) / Math.min(w, h)).toBeLessThanOrEqual(RATIO);
        expect(w * h).toBeGreaterThanOrEqual(MIN);
        expect(w * h).toBeLessThanOrEqual(MAX);
    };

    test("projects out-of-range sizes onto the valid set", () => {
        for (const [w, h] of [[800, 800], [5000, 5000], [5000, 1024], [3000, 500], [1, 1], [9999, 1]]) {
            const r = clampImageSize(w, h);
            assertValid(r.width, r.height);
            expect(r.clamped).toBe(true);
        }
    });

    test("leaves valid sizes unchanged and unflagged", () => {
        for (const [w, h] of [[1024, 1024], [1536, 1024], [3840, 1280]]) {
            const r = clampImageSize(w, h);
            expect(r.width).toBe(w);
            expect(r.height).toBe(h);
            expect(r.clamped).toBe(false);
        }
    });

    test("is idempotent", () => {
        for (const [w, h] of [[800, 800], [5000, 5000], [3000, 500]]) {
            const first = clampImageSize(w, h);
            const second = clampImageSize(first.width, first.height);
            expect(second.width).toBe(first.width);
            expect(second.height).toBe(first.height);
            expect(second.clamped).toBe(false);
        }
    });
});
