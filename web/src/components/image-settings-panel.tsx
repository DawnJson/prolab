import { type ReactNode, type RefObject, useRef, useState } from "react";
import { App, ConfigProvider, InputNumber, Switch } from "antd";

import { type CanvasTheme } from "@/lib/canvas-theme";
import { modelOptionName, type AiConfig } from "@/stores/use-config-store";
import { clampImageSizeForModel, resolveModelRequestSize } from "@/services/api/image";

const qualityOptions = [
    { value: "auto", label: "自动" },
    { value: "low", label: "低" },
    { value: "medium", label: "中" },
    { value: "high", label: "高" },
];
const resolutionOptions = [
    { value: "1k", label: "1K" },
    { value: "2k", label: "2K" },
    { value: "4k", label: "4K" },
];
const DIMENSION_STEP = 16;

const aspectOptions = [
    { value: "1:1", label: "1:1", width: 1024, height: 1024, icon: "square" },
    { value: "3:2", label: "3:2", width: 1536, height: 1024, icon: "landscape" },
    { value: "2:3", label: "2:3", width: 1024, height: 1536, icon: "portrait" },
    { value: "4:3", label: "4:3", width: 1360, height: 1024, icon: "landscape" },
    { value: "3:4", label: "3:4", width: 1024, height: 1360, icon: "portrait" },
    { value: "16:9", label: "16:9", width: 1824, height: 1024, icon: "landscape" },
    { value: "9:16", label: "9:16", width: 1024, height: 1824, icon: "portrait" },
    { value: "21:9", label: "21:9", width: 1552, height: 672, icon: "landscape" },
    { value: "9:21", label: "9:21", width: 672, height: 1552, icon: "portrait" },
    { value: "auto", label: "auto", width: 0, height: 0, icon: "auto" },
];

type SettingSection = "quality" | "resolution" | "size" | "aspect" | "count";

const ALL_SECTIONS: SettingSection[] = ["quality", "resolution", "size", "aspect", "count"];

type ImageSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "quality" | "resolution" | "size" | "count", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
    maxCount?: number;
    sections?: SettingSection[];
    qualityDisabled?: boolean;
};

export function ImageSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5", maxCount = 15, sections = ALL_SECTIONS, qualityDisabled = false }: ImageSettingsPanelProps) {
    const [snapDimensionToStep, setSnapDimensionToStep] = useState(true);
    const { message } = App.useApp();
    const widthRef = useRef<HTMLInputElement>(null);
    const heightRef = useRef<HTMLInputElement>(null);
    const show = (name: SettingSection) => sections.includes(name);
    const quality = config.quality || "auto";
    const resolution = config.resolution || "1k";
    const count = Math.max(1, Math.min(maxCount, Math.floor(Math.abs(Number(config.count)) || 1)));
    const activeSize = config.size || "auto";
    const model = modelOptionName(config.model || config.imageModel || "");
    const customDimensions = activeSize.match(/^(\d+)x(\d+)$/);
    const customRatio = customDimensions ? reduceRatio(Number(customDimensions[1]), Number(customDimensions[2])) : "";
    const activeRatio = activeSize.includes(":") ? activeSize : customRatio || "auto";
    const selectedAspect = aspectOptions.find((item) => item.value === activeRatio);
    const dimensions = readSizeDimensions(model, activeSize, resolution, selectedAspect || aspectOptions[0]);
    const isCustomSize = Boolean(customDimensions);
    const selectAspect = (value: string) => {
        onConfigChange("size", value);
    };
    const selectResolution = (value: string) => {
        if (isCustomSize) onConfigChange("size", reduceRatio(dimensions.width, dimensions.height));
        onConfigChange("resolution", value);
    };
    const enterCustomSize = () => {
        if (isCustomSize) return;
        onConfigChange("size", `${dimensions.width || 1024}x${dimensions.height || 1024}`);
    };
    const commitDimensions = () => {
        const rawWidth = Number(widthRef.current?.value) || dimensions.width || 1024;
        const rawHeight = Number(heightRef.current?.value) || dimensions.height || 1024;
        const size = clampImageSizeForModel(model, rawWidth, rawHeight);
        if (widthRef.current) widthRef.current.value = String(size.width);
        if (heightRef.current) heightRef.current.value = String(size.height);
        if (size.clamped) message.info(`尺寸超出可用范围，已自动调整为 ${size.width}×${size.height}`);
        onConfigChange("size", `${size.width}x${size.height}`);
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div
                className={className}
                style={{ color: theme.node.text }}
                onMouseDown={(event) => {
                    event.stopPropagation();
                    if (event.target instanceof HTMLInputElement) return;
                    if (document.activeElement instanceof HTMLInputElement && event.currentTarget.contains(document.activeElement)) document.activeElement.blur();
                }}
            >
                {showTitle ? <div className="text-lg font-semibold">图像设置</div> : null}
                {show("quality") ? (
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>{qualityDisabled ? "质量（当前模型不支持）" : "质量"}</SettingTitle>
                    <div className="grid grid-cols-4 gap-2.5">
                        {qualityOptions.map((item) => (
                            <OptionPill key={item.value} selected={!qualityDisabled && quality === item.value} disabled={qualityDisabled} theme={theme} onClick={() => onConfigChange("quality", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                </div>
                ) : null}
                {show("resolution") ? (
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>分辨率</SettingTitle>
                    <div className="grid grid-cols-4 gap-2.5">
                        <OptionPill selected={isCustomSize} theme={theme} onClick={enterCustomSize}>
                            自定义
                        </OptionPill>
                        {resolutionOptions.map((item) => (
                            <OptionPill key={item.value} selected={!isCustomSize && resolution === item.value} theme={theme} onClick={() => selectResolution(item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                </div>
                ) : null}
                {show("size") ? (
                <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-3">
                        <SettingTitle color={theme.node.muted}>尺寸</SettingTitle>
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-medium" style={{ color: theme.node.muted }}>
                                16倍数对齐
                            </span>
                            <span title="输入完成后自动向上补成 16 的倍数" onMouseDown={(event) => event.stopPropagation()}>
                                <Switch size="small" checked={snapDimensionToStep} onChange={setSnapDimensionToStep} />
                            </span>
                        </div>
                    </div>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                        <DimensionInput ref={widthRef} prefix="W" value={dimensions.width} disabled={activeSize === "auto"} theme={theme} alignToStep={snapDimensionToStep} onCommit={commitDimensions} />
                        <span className="text-lg opacity-45">↔</span>
                        <DimensionInput ref={heightRef} prefix="H" value={dimensions.height} disabled={activeSize === "auto"} theme={theme} alignToStep={snapDimensionToStep} onCommit={commitDimensions} />
                    </div>
                </div>
                ) : null}
                {show("aspect") ? (
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>宽高比</SettingTitle>
                    <div className="grid grid-cols-4 gap-2.5">
                        {aspectOptions.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className="flex h-[72px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border bg-transparent text-sm transition hover:opacity-80"
                                style={{ borderColor: selectedAspect?.value === item.value ? theme.node.text : theme.node.stroke, background: "transparent", color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => selectAspect(item.value)}
                            >
                                <AspectIcon type={item.icon} width={item.width} height={item.height} color={theme.node.text} />
                                <span>{item.label}</span>
                            </button>
                        ))}
                    </div>
                </div>
                ) : null}
                {show("count") ? (
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>生成张数</SettingTitle>
                    <div className="grid grid-cols-4 gap-2.5">
                        {[1, 2, 3].map((value) => (
                            <OptionPill key={value} selected={count === value} theme={theme} onClick={() => onConfigChange("count", String(value))}>
                                {value} 张
                            </OptionPill>
                        ))}
                        <CountInput value={count} max={maxCount} theme={theme} onChange={(value) => onConfigChange("count", String(value || 1))} />
                    </div>
                </div>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

export function ImageSettingsTheme({ theme, children }: { theme: CanvasTheme; children: ReactNode }) {
    return (
        <ConfigProvider
            theme={{
                token: { colorBgContainer: theme.toolbar.panel, colorBgElevated: theme.toolbar.panel, colorBorder: theme.node.stroke, colorPrimary: theme.node.activeStroke, colorText: theme.node.text, colorTextLightSolid: theme.node.panel },
                components: { Button: { defaultBg: theme.toolbar.panel, defaultBorderColor: theme.node.stroke, defaultColor: theme.node.text } },
            }}
        >
            {children}
        </ConfigProvider>
    );
}

export function imageQualityLabel(value: string) {
    return ({ auto: "自动", high: "高", medium: "中", low: "低" } as Record<string, string>)[value] || value;
}

export function imageSizeLabel(size: string) {
    const custom = size.match(/^(\d+)x(\d+)$/);
    if (custom) return `${custom[1]}×${custom[2]}`;
    return aspectOptions.find((item) => item.value === size)?.label || size;
}

function OptionPill({ selected, theme, onClick, children, disabled = false }: { selected: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode; disabled?: boolean }) {
    return (
        <button
            type="button"
            disabled={disabled}
            className={`h-9 rounded-full border px-2 text-sm transition ${disabled ? "cursor-not-allowed" : "cursor-pointer hover:opacity-80"}`}
            style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text, opacity: disabled ? 0.4 : 1 }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={disabled ? undefined : onClick}
        >
            {children}
        </button>
    );
}

function DimensionInput({ ref, prefix, value, disabled, theme, alignToStep, onCommit }: { ref: RefObject<HTMLInputElement | null>; prefix: string; value: number; disabled: boolean; theme: CanvasTheme; alignToStep: boolean; onCommit: () => void }) {
    const commit = (input: HTMLInputElement) => {
        const next = alignDimension(Math.max(1, Math.floor(Number(input.value) || value || 1024)), alignToStep);
        input.value = String(next);
        onCommit();
    };

    return (
        <label className="flex h-9 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text, opacity: disabled ? 0.55 : 1 }}>
            <span className="grid w-9 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input
                ref={ref}
                type="number"
                min={1}
                disabled={disabled}
                className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                defaultValue={value || ""}
                key={`${prefix}-${value}`}
                onBlur={(event) => commit(event.currentTarget)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function CountInput({ value, max, theme, onChange }: { value: number; max: number; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <div className="min-w-0" onMouseDown={(event) => event.stopPropagation()} style={{ color: theme.node.text }}>
            <InputNumber
                className="h-9 !w-full !min-w-0 [&_.ant-input-number-input]:h-full [&_.ant-input-number-input]:!text-center [&_.ant-input-number-input]:!text-inherit"
                min={1}
                max={max}
                value={value}
                controls
                onChange={(next) => onChange(typeof next === "number" ? next : null)}
                style={{ background: "transparent", borderColor: theme.node.stroke, color: theme.node.text }}
            />
        </div>
    );
}

function AspectIcon({ type, width, height, color }: { type: string; width: number; height: number; color: string }) {
    if (type === "auto") return null;
    const ratio = width / Math.max(1, height);
    const boxWidth = ratio >= 1 ? 24 : Math.max(10, 24 * ratio);
    const boxHeight = ratio >= 1 ? Math.max(10, 24 / ratio) : 24;
    return (
        <span className="grid h-7 w-9 place-items-center">
            <span className="border-2" style={{ width: boxWidth, height: boxHeight, borderColor: color }} />
        </span>
    );
}

function SettingTitle({ children, color }: { children: string; color: string }) {
    return (
        <div className="text-xs font-medium" style={{ color }}>
            {children}
        </div>
    );
}

function readSizeDimensions(model: string, size: string, resolution: string, fallback: { width: number; height: number }) {
    if (size && size !== "auto") {
        try {
            const resolved = resolveModelRequestSize(model, resolution, size);
            const match = resolved?.match(/^(\d+)x(\d+)$/);
            if (match) return { width: Number(match[1]), height: Number(match[2]) };
        } catch {
            // 超出像素/比例约束时回退到宽高比档位的预设尺寸
        }
    }
    return { width: fallback.width, height: fallback.height };
}

function reduceRatio(width: number, height: number) {
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    const divisor = gcd(width, height) || 1;
    return `${width / divisor}:${height / divisor}`;
}

function alignDimension(value: number, enabled: boolean) {
    return enabled ? Math.ceil(value / DIMENSION_STEP) * DIMENSION_STEP : value;
}
