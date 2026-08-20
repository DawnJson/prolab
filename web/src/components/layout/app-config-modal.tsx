import { App, Button, Checkbox, Form, Input, Modal, Progress, Select, Switch, Tabs } from "antd";
import { CircleAlert, Cloud, KeyRound, Link2, Plus, RefreshCw, ShieldCheck, Trash2, WandSparkles, Wifi } from "lucide-react";
import { useEffect, useState } from "react";

import { ModelPicker } from "@/components/model-picker";
import { QuickConnectModal } from "@/components/onboarding/quick-connect-modal";
import { DEFAULT_UPSTREAM } from "@/lib/pro-spec/constants";
import { fetchProApiTokenUsage, formatUsageAmount, summarizeModelCategories, type ProApiTokenUsage } from "@/lib/pro-spec/proapi-usage";
import { fetchChannelModels } from "@/services/api/image";
import { syncAppDataToWebdav, type AppSyncDomainKey, type AppSyncProgressEvent } from "@/services/app-sync";
import { testWebdavConnection, WEBDAV_MANIFEST_FILE_NAME } from "@/services/webdav-sync";
import { audioFormatOptions, audioVoiceOptions, normalizeAudioSpeedValue } from "@/lib/audio-generation";
import { useCanvasAgentStore } from "@/stores/canvas/use-canvas-agent-store";
import { channelSourceLabel, createModelChannel, defaultBaseUrlForApiFormat, filterModelsByCapability, mergeSuggestedModelOptions, modelOptionLabel, modelOptionSearchText, modelOptionsFromChannels, normalizeModelOptionValue, useConfigStore, type AiConfig, type ApiCallFormat, type ConfigTabKey, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";

type ModelGroup = {
    capability: ModelCapability;
    modelKey: "imageModel" | "videoModel" | "textModel" | "audioModel";
    modelsKey: "imageModels" | "videoModels" | "textModels" | "audioModels";
    defaultLabel: string;
    optionsLabel: string;
};

type WebdavDomainProgress = {
    label: string;
    stage: string;
    current?: number;
    total?: number;
    status?: "active" | "success" | "exception";
};

type ModelSelectionDraft = {
    channelId: string;
    channelName: string;
    channelSource: string;
    models: string[];
    selected: string[];
};

const modelGroups: ModelGroup[] = [
    { capability: "image", modelKey: "imageModel", modelsKey: "imageModels", defaultLabel: "默认生图模型", optionsLabel: "生图模型可选项" },
    { capability: "video", modelKey: "videoModel", modelsKey: "videoModels", defaultLabel: "默认视频模型", optionsLabel: "视频模型可选项" },
    { capability: "text", modelKey: "textModel", modelsKey: "textModels", defaultLabel: "默认文本模型", optionsLabel: "文本模型可选项" },
    { capability: "audio", modelKey: "audioModel", modelsKey: "audioModels", defaultLabel: "默认音频模型", optionsLabel: "音频模型可选项" },
];

const apiFormatOptions: Array<{ label: string; value: ApiCallFormat }> = [
    { label: "OpenAI", value: "openai" },
    { label: "Gemini", value: "gemini" },
];

const webdavDomainKeys: AppSyncDomainKey[] = ["canvas", "assets", "image-workbench", "video-workbench"];
const webdavDomainLabels: Record<AppSyncDomainKey, string> = {
    canvas: "画布",
    assets: "我的素材",
    "image-workbench": "生图工作台",
    "video-workbench": "视频创作台",
};
const codexSetupSteps = [
    { title: "安装 Codex 插件", text: "先在 Codex App 安装 Infinite Canvas 插件，插件会注册 MCP 并尝试启动本地 Canvas Agent。" },
    { title: "连接本地 Agent", text: "在本页填入 Local URL 和 Connect token 后点击连接。" },
    { title: "手动启动备用", text: "如果插件没有自动启动本地服务，在终端运行下面命令。", command: "npx -y @basketikun/canvas-agent" },
];

function createWebdavDomainProgress(): Record<AppSyncDomainKey, WebdavDomainProgress> {
    return webdavDomainKeys.reduce(
        (progress, key) => ({
            ...progress,
            [key]: { label: webdavDomainLabels[key], stage: "等待同步" },
        }),
        {} as Record<AppSyncDomainKey, WebdavDomainProgress>,
    );
}

export function AppConfigPanel({ showDoneButton = false, initialTab = "channels" }: { showDoneButton?: boolean; initialTab?: ConfigTabKey }) {
    const { message } = App.useApp();
    const [activeTab, setActiveTab] = useState<ConfigTabKey>(initialTab);
    const [loadingChannelId, setLoadingChannelId] = useState("");
    const [testingWebdav, setTestingWebdav] = useState(false);
    const [syncingWebdav, setSyncingWebdav] = useState(false);
    const [quickConnectOpen, setQuickConnectOpen] = useState(false);
    const [proApiUsage, setProApiUsage] = useState<ProApiTokenUsage | null>(null);
    const [proApiUsageError, setProApiUsageError] = useState("");
    const [loadingProApiUsage, setLoadingProApiUsage] = useState(false);
    const [modelSelection, setModelSelection] = useState<ModelSelectionDraft | null>(null);
    const [webdavSyncStatus, setWebdavSyncStatus] = useState("");
    const [webdavDomainProgress, setWebdavDomainProgress] = useState(createWebdavDomainProgress);
    const config = useConfigStore((state) => state.config);
    const webdav = useConfigStore((state) => state.webdav);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const updateWebdavConfig = useConfigStore((state) => state.updateWebdavConfig);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);
    const agentUrl = useCanvasAgentStore((state) => state.url);
    const agentToken = useCanvasAgentStore((state) => state.token);
    const agentConnected = useCanvasAgentStore((state) => state.connected);
    const agentEnabled = useCanvasAgentStore((state) => state.enabled);
    const agentActivity = useCanvasAgentStore((state) => state.activity);
    const agentConnectError = useCanvasAgentStore((state) => state.connectError);
    const agentConfirmTools = useCanvasAgentStore((state) => state.confirmTools);
    const setAgentState = useCanvasAgentStore((state) => state.setAgentState);
    const connectAgent = useCanvasAgentStore((state) => state.connectAgent);
    const disconnectAgent = useCanvasAgentStore((state) => state.disconnectAgent);
    const modelOptions = config.models.map((model) => ({ label: modelOptionLabel(config, model), value: model, searchText: modelOptionSearchText(config, model) }));
    const webdavReady = Boolean(webdav.url.trim());
    const proApiChannel = config.channels[0];
    const proApiModelSummary = summarizeModelCategories(proApiChannel?.models || []);
    useEffect(() => setActiveTab(initialTab), [initialTab]);

    const saveConfig = (nextConfig: AiConfig) => {
        (Object.keys(nextConfig) as Array<keyof AiConfig>).forEach((key) => updateConfig(key, nextConfig[key]));
    };

    const finishConfig = () => {
        const ready = config.channels.some((channel) => channel.baseUrl.trim() && channel.apiKey.trim() && channel.models.length);
        setConfigDialogOpen(false);
        if (!ready) return;
        message.success(shouldPromptContinue ? "配置已保存，请继续刚才的请求" : "配置已保存");
        clearPromptContinue();
    };

    const updateChannels = (channels: ModelChannel[]) => {
        const nextConfig = withChannels(config, channels);
        saveConfig(nextConfig);
    };

    const updateChannel = (id: string, patch: Partial<ModelChannel>) => {
        updateChannels(config.channels.map((channel) => (channel.id === id ? { ...channel, ...patch, models: patch.models ? uniqueModels(patch.models) : channel.models } : channel)));
    };

    const updateChannelApiFormat = (channel: ModelChannel, apiFormat: ApiCallFormat) => {
        const baseUrl = !channel.baseUrl.trim() || channel.baseUrl.trim() === defaultBaseUrlForApiFormat(channel.apiFormat) ? defaultBaseUrlForApiFormat(apiFormat) : channel.baseUrl;
        updateChannel(channel.id, { apiFormat, baseUrl });
    };

    const addChannel = () => {
        updateChannels([...config.channels, createModelChannel({ name: `渠道 ${config.channels.length + 1}`, baseUrl: `${DEFAULT_UPSTREAM.baseUrl}/`, apiFormat: "openai" })]);
    };

    const deleteChannel = (id: string) => {
        if (config.channels.length <= 1) {
            message.warning("至少保留一个渠道");
            return;
        }
        updateChannels(config.channels.filter((channel) => channel.id !== id));
    };

    const refreshChannelModels = async (channel: ModelChannel) => {
        if (!channel.baseUrl.trim() || !channel.apiKey.trim()) {
            message.error("请先填写该渠道的 Base URL 和 API Key");
            return;
        }
        setLoadingChannelId(channel.id);
        try {
            const models = await fetchChannelModels(channel);
            const current = new Set(channel.models);
            const selected = models.filter((model) => current.has(model));
            setModelSelection({
                channelId: channel.id,
                channelName: channel.name,
                channelSource: channelSourceLabel(config, channel),
                models,
                selected: selected.length ? selected : models,
            });
            message.success(`已拉取 ${models.length} 个模型，请选择要保存的模型`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取模型失败");
        } finally {
            setLoadingChannelId("");
        }
    };

    const confirmModelSelection = () => {
        if (!modelSelection) return;
        if (!modelSelection.selected.length) {
            message.error("请至少选择一个模型");
            return;
        }
        updateChannel(modelSelection.channelId, { models: modelSelection.selected });
        message.success(`${modelSelection.channelName} 已保存 ${modelSelection.selected.length} 个模型`);
        setModelSelection(null);
    };

    const selectAllFetchedModels = () => {
        setModelSelection((current) => (current ? { ...current, selected: current.models } : current));
    };

    const invertFetchedModels = () => {
        setModelSelection((current) => {
            if (!current) return current;
            const selected = new Set(current.selected);
            return { ...current, selected: current.models.filter((model) => !selected.has(model)) };
        });
    };

    const refreshAllModels = async () => {
        const runnable = config.channels.filter((channel) => channel.baseUrl.trim() && channel.apiKey.trim());
        if (!runnable.length) {
            message.error("请先填写至少一个渠道的 Base URL 和 API Key");
            return;
        }
        setLoadingChannelId("all");
        try {
            const entries = await Promise.all(runnable.map(async (channel) => [channel.id, await fetchChannelModels(channel)] as const));
            const modelMap = new Map(entries);
            updateChannels(config.channels.map((channel) => (modelMap.has(channel.id) ? { ...channel, models: modelMap.get(channel.id) || [] } : channel)));
            message.success("模型列表已更新");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取模型失败");
        } finally {
            setLoadingChannelId("");
        }
    };

    const refreshProApiUsage = async () => {
        const channel = proApiChannel;
        if (!channel?.baseUrl.trim() || !channel.apiKey.trim()) {
            message.error("请先完成 ProAPI 一键接入或填写主渠道 API Key");
            return;
        }
        setLoadingProApiUsage(true);
        setProApiUsageError("");
        try {
            const usage = await fetchProApiTokenUsage({ baseUrl: channel.baseUrl, apiKey: channel.apiKey });
            setProApiUsage(usage);
            message.success("ProAPI 额度已更新");
        } catch (error) {
            const text = error instanceof Error ? error.message : "额度查询失败";
            setProApiUsageError(text);
            message.error(text);
        } finally {
            setLoadingProApiUsage(false);
        }
    };

    const updateCapabilityModels = (group: ModelGroup, models: string[]) => {
        const next = uniqueModels(models.map((model) => normalizeModelOptionValue(model, config.channels)).filter(Boolean));
        updateConfig(group.modelsKey, next);
        if (!next.includes(config[group.modelKey])) updateConfig(group.modelKey, next[0] || "");
    };

    const testWebdav = async () => {
        if (!webdavReady) {
            message.error("请先填写 WebDAV 地址");
            return;
        }
        setTestingWebdav(true);
        try {
            await testWebdavConnection(webdav);
            message.success("WebDAV 连接可用");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "WebDAV 连接测试失败");
        } finally {
            setTestingWebdav(false);
        }
    };

    const updateWebdavProgress = (event: AppSyncProgressEvent) => {
        setWebdavSyncStatus(event.stage);
        if (!event.domain) return;
        setWebdavDomainProgress((current) => ({
            ...current,
            [event.domain as AppSyncDomainKey]: {
                label: event.label || webdavDomainLabels[event.domain as AppSyncDomainKey],
                stage: event.stage,
                current: event.current,
                total: event.total,
                status: event.status,
            },
        }));
    };

    const syncWebdav = async () => {
        if (!webdavReady) {
            message.error("请先填写 WebDAV 地址");
            return;
        }
        setSyncingWebdav(true);
        setWebdavDomainProgress(createWebdavDomainProgress());
        setWebdavSyncStatus("准备同步");
        try {
            const result = await syncAppDataToWebdav(webdav, updateWebdavProgress);
            updateWebdavConfig("lastSyncedAt", result.syncedAt);
            message.success(`同步完成：${result.projects} 个画布，${result.assets} 个素材，${result.imageLogs + result.videoLogs} 条记录，本次上传 ${result.uploadedFiles} 个文件 ${formatBytes(result.uploadedBytes)}`);
        } catch (error) {
            setWebdavSyncStatus(error instanceof Error ? error.message : "WebDAV 同步失败");
            message.error(error instanceof Error ? error.message : "WebDAV 同步失败");
        } finally {
            setSyncingWebdav(false);
        }
    };

    const updateAgentConfig = (patch: { url?: string; token?: string }) => {
        setAgentState({ ...patch, connectError: "" });
        if (patch.url !== undefined) localStorage.setItem("canvas-agent-url", patch.url.trim().replace(/\/$/, ""));
        if (patch.token !== undefined) localStorage.setItem("canvas-agent-token", patch.token);
    };

    const toggleAgentConnection = () => (agentEnabled ? disconnectAgent({ connectError: "" }) : connectAgent());

    return (
        <>
            <Tabs
                activeKey={activeTab}
                onChange={(key) => setActiveTab(key as ConfigTabKey)}
                items={[
                    {
                        key: "channels",
                        label: "渠道",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                            <span>新增或拉取模型后，需要到“模型”Tab 选择可选项才会显示。</span>
                                            <Button type="link" size="small" className="h-auto p-0 text-xs font-semibold" onClick={() => setActiveTab("models")}>
                                                去模型设置
                                            </Button>
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 gap-2">
                                        <Button icon={<WandSparkles className="size-4" />} onClick={() => setQuickConnectOpen(true)}>
                                            一键接入
                                        </Button>
                                        <Button icon={<RefreshCw className="size-4" />} loading={Boolean(loadingChannelId)} onClick={() => void refreshAllModels()}>
                                            拉取全部
                                        </Button>
                                        <Button type="primary" icon={<Plus className="size-4" />} onClick={addChannel}>
                                            新增渠道
                                        </Button>
                                    </div>
                                </div>
                                <section className="mb-4 rounded-lg border border-border p-3">
                                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                                        <div>
                                            <div className="text-sm font-semibold">ProAPI 状态</div>
                                            <div className="mt-1 text-xs text-muted-foreground">这里只使用 sk- API Key 查询模型与额度，不需要 AccessToken。</div>
                                        </div>
                                        <Button size="small" icon={<RefreshCw className="size-3.5" />} loading={loadingProApiUsage} onClick={() => void refreshProApiUsage()}>
                                            刷新额度
                                        </Button>
                                    </div>
                                    <div className="grid gap-2 text-sm md:grid-cols-5">
                                        <StatusItem label="主渠道" value={proApiChannel?.name || "未配置"} />
                                        <StatusItem label="模型" value={`${proApiModelSummary.total} 个`} />
                                        <StatusItem label="图像 / 视频" value={`${proApiModelSummary.image} / ${proApiModelSummary.video}`} />
                                        <StatusItem label="剩余额度" value={proApiUsage ? (proApiUsage.unlimitedQuota ? "无限额度" : formatUsageAmount(proApiUsage.totalAvailable)) : "未查询"} />
                                        <StatusItem label="模型白名单" value={proApiUsage ? (proApiUsage.modelLimitsEnabled ? `${proApiUsage.modelLimits.length} 个` : "未限制") : "未查询"} />
                                    </div>
                                    {proApiUsageError ? <div className="mt-2 text-xs text-muted-foreground">额度未读取：{proApiUsageError}</div> : null}
                                </section>
                                <div className="space-y-3">
                                    {config.channels.map((channel) => (
                                        <section key={channel.id} className="rounded-lg border border-border p-3">
                                            <div className="mb-3 flex items-center justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="truncate text-sm font-semibold">{channel.name || "未命名渠道"}</div>
                                                    <div className="mt-1 text-xs text-muted-foreground">
                                                        {apiFormatLabel(channel.apiFormat)} · 已保存 {channel.models.length} 个模型
                                                    </div>
                                                </div>
                                                <div className="flex shrink-0 gap-2">
                                                    <Button size="small" loading={loadingChannelId === channel.id} onClick={() => void refreshChannelModels(channel)}>
                                                        拉取模型
                                                    </Button>
                                                    <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => deleteChannel(channel.id)} />
                                                </div>
                                            </div>
                                            <div className="grid gap-4 md:grid-cols-2">
                                                <Form.Item label="渠道名称" className="mb-0">
                                                    <Input value={channel.name} onChange={(event) => updateChannel(channel.id, { name: event.target.value })} />
                                                </Form.Item>
                                                <Form.Item label="调用格式" className="mb-0">
                                                    <Select value={channel.apiFormat} options={apiFormatOptions} onChange={(value: ApiCallFormat) => updateChannelApiFormat(channel, value)} />
                                                </Form.Item>
                                                <Form.Item label="Base URL" className="mb-0">
                                                    <Input value={channel.baseUrl} onChange={(event) => updateChannel(channel.id, { baseUrl: event.target.value })} />
                                                </Form.Item>
                                                <Form.Item label="API Key" className="mb-0">
                                                    <Input.Password value={channel.apiKey} onChange={(event) => updateChannel(channel.id, { apiKey: event.target.value })} />
                                                </Form.Item>
                                                <Form.Item label="模型列表" className="mb-0 md:col-span-2">
                                                    <Select mode="tags" showSearch allowClear maxTagCount="responsive" placeholder="输入模型名，或点击拉取模型" value={channel.models} onChange={(models) => updateChannel(channel.id, { models })} />
                                                </Form.Item>
                                            </div>
                                        </section>
                                    ))}
                                </div>
                            </Form>
                        ),
                    },
                    {
                        key: "models",
                        label: "模型",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <div className="mb-4 rounded-lg border border-border p-3">
                                    <div className="text-sm font-semibold">默认模型和可选项</div>
                                    <div className="mt-1 text-xs leading-5 text-muted-foreground">可选项决定各处下拉框展示哪些模型；同名模型会显示渠道序号、Base URL 和 Key 后四位，选择后会精确使用对应 API Key。</div>
                                    <div className="mt-1 text-xs leading-5 text-muted-foreground">搜索支持模型名、渠道名、域名和 Key 后四位；这里不能手动输入裸模型名，需要先在“渠道”里添加或拉取模型。</div>
                                </div>
                                <div className="grid gap-4 md:grid-cols-2">
                                    {modelGroups.map((group) => (
                                        <Form.Item key={group.modelsKey} label={group.optionsLabel} className="mb-0">
                                            <Select
                                                mode="multiple"
                                                showSearch
                                                allowClear
                                                maxTagCount="responsive"
                                                placeholder={config.models.length ? `请选择${group.optionsLabel}` : "先到渠道里填写或拉取模型"}
                                                value={config[group.modelsKey]}
                                                options={modelOptions}
                                                optionFilterProp="searchText"
                                                filterOption={(input, option) => {
                                                    const data = option as { searchText?: unknown; label?: unknown; value?: unknown } | undefined;
                                                    const text = String(data?.searchText ?? data?.label ?? data?.value ?? "").toLowerCase();
                                                    return text.includes(input.trim().toLowerCase());
                                                }}
                                                onChange={(models) => updateCapabilityModels(group, models)}
                                            />
                                        </Form.Item>
                                    ))}
                                </div>
                                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                    {modelGroups.map((group) => (
                                        <Form.Item key={group.modelKey} label={group.defaultLabel} className="mb-0">
                                            <ModelPicker config={config} value={config[group.modelKey]} onChange={(model) => updateConfig(group.modelKey, model)} capability={group.capability} fullWidth />
                                        </Form.Item>
                                    ))}
                                </div>
                            </Form>
                        ),
                    },
                    {
                        key: "preferences",
                        label: "生成偏好",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <div className="grid gap-4 md:grid-cols-4">
                                    <Form.Item label="画布默认生图张数" extra="新建画布生图和配置节点默认使用，单个节点仍可单独覆盖。" className="mb-4">
                                        <Input
                                            type="number"
                                            min={1}
                                            max={15}
                                            value={config.canvasImageCount}
                                            onChange={(event) => updateConfig("canvasImageCount", event.target.value)}
                                            onBlur={(event) => updateConfig("canvasImageCount", normalizeImageCount(event.target.value))}
                                        />
                                    </Form.Item>
                                    <Form.Item label="默认音频声音" className="mb-4">
                                        <Select value={config.audioVoice} options={audioVoiceOptions} onChange={(value) => updateConfig("audioVoice", value)} />
                                    </Form.Item>
                                    <Form.Item label="默认音频格式" className="mb-4">
                                        <Select value={config.audioFormat} options={audioFormatOptions} onChange={(value) => updateConfig("audioFormat", value)} />
                                    </Form.Item>
                                    <Form.Item label="默认音频语速" className="mb-4">
                                        <Input
                                            type="number"
                                            min={0.25}
                                            max={4}
                                            step={0.05}
                                            value={config.audioSpeed}
                                            onChange={(event) => updateConfig("audioSpeed", event.target.value)}
                                            onBlur={(event) => updateConfig("audioSpeed", normalizeAudioSpeedValue(event.target.value))}
                                        />
                                    </Form.Item>
                                </div>
                                <Form.Item label="默认音频指令" className="mb-4">
                                    <Input.TextArea rows={2} value={config.audioInstructions} placeholder="例如：自然、温暖、适合旁白。" onChange={(event) => updateConfig("audioInstructions", event.target.value)} />
                                </Form.Item>
                                <Form.Item label="系统提示词" className="mb-0">
                                    <Input.TextArea rows={4} value={config.systemPrompt} placeholder="例如：你是一位擅长电影感写实摄影的视觉导演。" onChange={(event) => updateConfig("systemPrompt", event.target.value)} />
                                </Form.Item>
                            </Form>
                        ),
                    },
                    {
                        key: "webdav",
                        label: "WebDAV",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <section className="rounded-lg border border-border p-3">
                                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <div className="flex items-center gap-2 text-sm font-semibold">
                                                <Cloud className="size-4" />
                                                WebDAV 同步
                                            </div>
                                            <div className="mt-1 text-xs text-stone-500">同步画布、我的素材、生成记录和本地媒体文件，不包含 AI API Key；浏览器会直接连接 WebDAV 服务。</div>
                                        </div>
                                        <div className="text-xs text-muted-foreground">{webdav.lastSyncedAt ? `上次同步 ${formatWebdavTime(webdav.lastSyncedAt)}` : "尚未同步"}</div>
                                    </div>
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <Form.Item label="WebDAV 地址" className="mb-4">
                                            <Input value={webdav.url} placeholder="https://nas.example.com/webdav" onChange={(event) => updateWebdavConfig("url", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label="远程目录" extra={`会在该目录下分业务目录保存，每个目录包含 ${WEBDAV_MANIFEST_FILE_NAME} 和 files/`} className="mb-4">
                                            <Input value={webdav.directory} placeholder="prolab" onChange={(event) => updateWebdavConfig("directory", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label="用户名" className="mb-0">
                                            <Input value={webdav.username} autoComplete="username" onChange={(event) => updateWebdavConfig("username", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label="密码 / 应用密码" className="mb-0">
                                            <Input.Password value={webdav.password} autoComplete="current-password" onChange={(event) => updateWebdavConfig("password", event.target.value)} />
                                        </Form.Item>
                                    </div>
                                    <div className="mt-4 flex flex-wrap items-center gap-2">
                                        <Button icon={<Wifi className="size-4" />} disabled={!webdavReady || syncingWebdav} loading={testingWebdav} onClick={() => void testWebdav()}>
                                            测试连接
                                        </Button>
                                        <Button type="primary" icon={<RefreshCw className="size-4" />} disabled={!webdavReady || testingWebdav} loading={syncingWebdav} onClick={() => void syncWebdav()}>
                                            {syncingWebdav ? "同步中" : "立即同步"}
                                        </Button>
                                        {webdavSyncStatus ? <span className="text-xs text-muted-foreground">{webdavSyncStatus}</span> : null}
                                    </div>
                                    {syncingWebdav || webdavSyncStatus ? <WebdavProgressGrid progress={webdavDomainProgress} /> : null}
                                </section>
                            </Form>
                        ),
                    },
                    {
                        key: "codex",
                        label: "Codex",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <section className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <div className="flex items-center gap-2 text-sm font-semibold">
                                                <Link2 className="size-4" />
                                                连接本地 Codex
                                            </div>
                                            <div className="mt-1 text-xs text-stone-500">用于画布 Agent 连接本机 Codex 插件启动的 Canvas Agent。</div>
                                        </div>
                                        <div className={agentConnectError ? "text-xs text-red-600" : "text-xs text-stone-500"}>{agentConnectError ? "连接失败" : agentConnected ? agentActivity || "已连接" : agentEnabled ? "连接中" : "未连接"}</div>
                                    </div>
                                    <div className="mb-4 grid gap-2 md:grid-cols-3">
                                        {codexSetupSteps.map((step, index) => (
                                            <div key={step.title} className="rounded-md border border-stone-200 p-3 dark:border-stone-800">
                                                <div className="text-xs font-semibold text-stone-500">步骤 {index + 1}</div>
                                                <div className="mt-1 text-sm font-medium">{step.title}</div>
                                                <div className="mt-1 text-xs leading-5 text-stone-500">{step.text}</div>
                                                {step.command ? <code className="mt-2 block overflow-x-auto rounded bg-stone-100 px-2 py-1.5 text-[11px] text-stone-700 dark:bg-stone-900 dark:text-stone-200">{step.command}</code> : null}
                                            </div>
                                        ))}
                                    </div>
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <Form.Item label="Local URL" className="mb-4">
                                            <Input prefix={<Link2 className="mr-1 size-4 text-stone-400" />} value={agentUrl} placeholder="http://127.0.0.1:17371" onChange={(event) => updateAgentConfig({ url: event.target.value })} />
                                        </Form.Item>
                                        <Form.Item label="Connect token" className="mb-4">
                                            <Input.Password prefix={<KeyRound className="mr-1 size-4 text-stone-400" />} value={agentToken} placeholder="自动发现，或手动填入 Connect token" onChange={(event) => updateAgentConfig({ token: event.target.value })} />
                                        </Form.Item>
                                    </div>
                                    {agentConnectError ? <div className="mb-3 rounded-md border border-red-200 px-3 py-2 text-xs text-red-600 dark:border-red-900/60">{agentConnectError}</div> : null}
                                    <div className="mb-3 flex justify-end">
                                        <Button type={agentEnabled ? "default" : "primary"} icon={<Wifi className="size-4" />} onClick={toggleAgentConnection}>
                                            {agentConnected ? "断开" : agentEnabled ? "取消连接" : "连接"}
                                        </Button>
                                    </div>
                                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-stone-200 px-3 py-2 dark:border-stone-800">
                                        <div className="flex min-w-0 items-center gap-2">
                                            <ShieldCheck className="size-4 text-stone-500" />
                                            <div>
                                                <div className="text-sm font-medium">执行画布操作前确认</div>
                                                <div className="mt-0.5 text-xs text-stone-500">关闭后，本地 Codex 可直接执行画布工具调用。不再需要人工确认</div>
                                            </div>
                                        </div>
                                        <Switch checked={agentConfirmTools} onChange={(confirmTools) => setAgentState({ confirmTools })} />
                                    </div>
                                </section>
                            </Form>
                        ),
                    },
                ]}
            />
            {showDoneButton ? (
                <div className="mt-4 flex justify-end">
                    <Button type="primary" onClick={finishConfig}>
                        完成
                    </Button>
                </div>
            ) : null}
        <QuickConnectModal open={quickConnectOpen} onClose={() => setQuickConnectOpen(false)} />
        <Modal
            title="选择要保存的模型"
            open={Boolean(modelSelection)}
            width={820}
            centered
            onCancel={() => setModelSelection(null)}
            onOk={confirmModelSelection}
            okText="保存选择"
            cancelText="取消"
            styles={{ body: { maxHeight: "64vh", overflowY: "auto", paddingRight: 8 } }}
        >
            {modelSelection ? (
                <div>
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                        <div className="text-sm text-muted-foreground">
                            {modelSelection.channelSource} · 已选择 {modelSelection.selected.length} / {modelSelection.models.length} 个模型
                        </div>
                        <div className="flex gap-2">
                            <Button size="small" onClick={selectAllFetchedModels}>
                                全选
                            </Button>
                            <Button size="small" onClick={invertFetchedModels}>
                                反选
                            </Button>
                        </div>
                    </div>
                    <Checkbox.Group
                        className="grid w-full gap-2 md:grid-cols-2"
                        value={modelSelection.selected}
                        onChange={(values) => setModelSelection((current) => (current ? { ...current, selected: values.map(String) } : current))}
                    >
                        {modelSelection.models.map((model) => (
                            <Checkbox key={model} value={model} className="min-w-0 rounded-md border border-border px-2 py-1.5">
                                <span className="block min-w-0 truncate">{model}</span>
                            </Checkbox>
                        ))}
                    </Checkbox.Group>
                </div>
            ) : null}
        </Modal>
        </>
    );
}

export function AppConfigModal() {
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const configTab = useConfigStore((state) => state.configTab);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    return (
        <Modal
            title={
                <div>
                    <div className="text-lg font-semibold">配置与用户偏好</div>
                    <div className="mt-1 text-xs font-normal text-stone-500">渠道聚合、模型选择和同步偏好</div>
                </div>
            }
            open={isConfigOpen}
            width={980}
            centered
            onCancel={() => setConfigDialogOpen(false)}
            styles={{ body: { maxHeight: "72vh", overflowY: "auto", paddingRight: 12 } }}
            footer={null}
        >
            <AppConfigPanel showDoneButton initialTab={configTab} />
        </Modal>
    );
}

function withChannels(config: AiConfig, channels: ModelChannel[]): AiConfig {
    const models = modelOptionsFromChannels(channels);
    const imageModels = keepOrSuggest(config.imageModels, filterModelsByCapability(models, "image"), models);
    const videoModels = keepOrSuggest(config.videoModels, filterModelsByCapability(models, "video"), models);
    const textModels = keepOrSuggest(config.textModels, filterModelsByCapability(models, "text"), models);
    const audioModels = keepOrSuggest(config.audioModels, filterModelsByCapability(models, "audio"), models);
    return {
        ...config,
        channels,
        models,
        baseUrl: channels[0]?.baseUrl || config.baseUrl,
        apiKey: channels[0]?.apiKey || config.apiKey,
        apiFormat: channels[0]?.apiFormat || config.apiFormat,
        imageModels,
        videoModels,
        textModels,
        audioModels,
        imageModel: normalizeDefaultModel(config.imageModel, imageModels),
        videoModel: normalizeDefaultModel(config.videoModel, videoModels),
        textModel: normalizeDefaultModel(config.textModel, textModels),
        audioModel: normalizeDefaultModel(config.audioModel, audioModels),
    };
}

function keepOrSuggest(current: string[], suggested: string[], allModels: string[]) {
    const available = new Set(allModels);
    const kept = uniqueModels(current).filter((model) => available.has(model));
    return mergeSuggestedModelOptions(kept, suggested);
}

function normalizeDefaultModel(value: string, options: string[]) {
    if (options.includes(value)) return value;
    return options[0] || value;
}

function normalizeImageCount(value: string) {
    return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 1))));
}

function uniqueModels(models: string[]) {
    return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));
}

function apiFormatLabel(apiFormat: ApiCallFormat) {
    return apiFormat === "gemini" ? "Gemini" : "OpenAI";
}

function StatusItem({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0 rounded-md border border-border px-3 py-2">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-1 truncate font-medium">{value}</div>
        </div>
    );
}

function formatWebdavTime(value: string) {
    return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function WebdavProgressGrid({ progress }: { progress: Record<AppSyncDomainKey, WebdavDomainProgress> }) {
    return (
        <div className="mt-3 grid gap-2">
            {webdavDomainKeys.map((key) => {
                const item = progress[key];
                const count = item.total ? `${item.current || 0}/${item.total}` : "";
                return (
                    <div key={key} className="rounded-md border border-border px-3 py-2">
                        <div className="mb-1 flex min-w-0 items-center justify-between gap-3 text-xs">
                            <span className="shrink-0 font-medium text-foreground">{item.label}</span>
                            <span className="min-w-0 truncate text-right text-muted-foreground">
                                {item.stage}
                                {count ? ` · ${count}` : ""}
                            </span>
                        </div>
                        <Progress percent={getWebdavProgressPercent(item)} size="small" status={getWebdavProgressStatus(item)} showInfo={false} />
                    </div>
                );
            })}
        </div>
    );
}

function getWebdavProgressPercent(item: WebdavDomainProgress) {
    if (item.status === "success") return 100;
    if (item.total) return Math.min(100, Math.round(((item.current || 0) / item.total) * 100));
    if (item.status === "exception") return 100;
    if (item.stage === "等待同步") return 0;
    if (item.stage === "读取远端清单") return 12;
    if (item.stage === "读取本地数据") return 24;
    if (item.stage === "下载缺失媒体") return 36;
    if (item.stage === "写入本地合并结果") return 58;
    if (item.stage === "上传新增媒体") return 66;
    if (item.stage === "媒体已齐全" || item.stage === "媒体无需上传") return 74;
    if (item.stage.startsWith("上传清单")) return 90;
    return item.status === "active" ? 30 : 0;
}

function getWebdavProgressStatus(item: WebdavDomainProgress): "normal" | "active" | "success" | "exception" {
    if (item.status === "success" || item.status === "exception") return item.status;
    return item.status === "active" ? "active" : "normal";
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
