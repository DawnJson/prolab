import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Input, Modal } from "antd";
import { Expand, RotateCcw, X } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { aspectOutpaintPadding, moveOutpaintSource, redistributeOutpaintPadding, scaleOutpaintPadding, type ImageOutpaintPadding } from "@/lib/canvas/canvas-image-data";
import { readImageMeta } from "@/lib/image-utils";
import { clampImageSizeForModel } from "@/services/api/image";
import { useThemeStore } from "@/stores/use-theme-store";

export type CanvasImageOutpaintPayload = {
    prompt: string;
    padding: ImageOutpaintPadding;
};

type ResizeHandle = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";

const handles: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const scaleOptions = [1.2, 1.5, 2];
const aspectOptions = [
    { value: "1:1", width: 1, height: 1 },
    { value: "3:2", width: 3, height: 2 },
    { value: "2:3", width: 2, height: 3 },
    { value: "4:3", width: 4, height: 3 },
    { value: "3:4", width: 3, height: 4 },
    { value: "16:9", width: 16, height: 9 },
    { value: "9:16", width: 9, height: 16 },
    { value: "21:9", width: 21, height: 9 },
    { value: "9:21", width: 9, height: 21 },
];
const defaultScale = 1.5;
const previewMaxWidth = 520;
const previewMaxHeight = 420;
const emptyPadding: ImageOutpaintPadding = { top: 0, right: 0, bottom: 0, left: 0 };

export function CanvasNodeOutpaintDialog({
    dataUrl,
    model,
    open,
    onClose,
    onConfirm,
}: {
    dataUrl: string;
    model: string;
    open: boolean;
    onClose: () => void;
    onConfirm: (payload: CanvasImageOutpaintPayload) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [image, setImage] = useState<{ width: number; height: number } | null>(null);
    const [padding, setPadding] = useState<ImageOutpaintPadding>(emptyPadding);
    const [prompt, setPrompt] = useState("");
    const output = image ? { width: image.width + padding.left + padding.right, height: image.height + padding.top + padding.bottom } : null;
    const minSize = image ? clampImageSizeForModel(model, image.width, image.height) : null;
    const canExpand = Boolean(output && (output.width > (image?.width || 0) || output.height > (image?.height || 0)));
    const atMinSize = Boolean(output && minSize && output.width <= minSize.width && output.height <= minSize.height);
    const grownSize = output ? clampImageSizeForModel(model, output.width + 64, output.height + 64) : null;
    const atMaxSize = Boolean(output && grownSize && grownSize.width <= output.width && grownSize.height <= output.height);
    const preview = output ? Math.min(previewMaxWidth / output.width, previewMaxHeight / output.height) : 1;
    const scaleX = image && output ? output.width / image.width : 0;
    const activeScale = image && output && Math.abs(scaleX - output.height / image.height) <= 0.04 ? scaleOptions.find((scale) => Math.abs(scaleX - scale) < 0.04) || null : null;
    const activeAspect = output ? aspectOptions.find((item) => Math.abs(output.width / Math.max(1, output.height) - item.width / item.height) < 0.03)?.value || "" : "";

    useEffect(() => {
        if (!open) return;
        setPrompt("");
        setImage(null);
        setPadding(emptyPadding);
        void readImageMeta(dataUrl).then((meta) => {
            setImage(meta);
            setPadding(fitPadding(meta.width, meta.height, scaleOutpaintPadding(meta.width, meta.height, defaultScale), model));
        });
    }, [dataUrl, model, open]);

    const sourceStyle = useMemo(() => {
        if (!image || !output) return null;
        return {
            left: `${(padding.left / output.width) * 100}%`,
            top: `${(padding.top / output.height) * 100}%`,
            width: `${(image.width / output.width) * 100}%`,
            height: `${(image.height / output.height) * 100}%`,
        };
    }, [image, output, padding.left, padding.top]);

    const startDrag = (handle: ResizeHandle, event: ReactPointerEvent) => {
        if (!image) return;
        event.preventDefault();
        event.stopPropagation();
        const start = { x: event.clientX, y: event.clientY, padding };
        const scale = preview;
        const move = (moveEvent: PointerEvent) => {
            const dx = (moveEvent.clientX - start.x) / scale;
            const dy = (moveEvent.clientY - start.y) / scale;
            const next = { ...start.padding };
            if (handle.includes("e")) next.right = start.padding.right + dx;
            if (handle.includes("w")) next.left = start.padding.left - dx;
            if (handle.includes("s")) next.bottom = start.padding.bottom + dy;
            if (handle.includes("n")) next.top = start.padding.top - dy;
            setPadding(fitPadding(image.width, image.height, next, model));
        };
        const up = () => {
            document.removeEventListener("pointermove", move);
            document.removeEventListener("pointerup", up);
        };
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", up);
    };

    const startMove = (event: ReactPointerEvent) => {
        if (!image) return;
        event.preventDefault();
        event.stopPropagation();
        const start = { x: event.clientX, y: event.clientY, padding };
        const scale = preview;
        const move = (moveEvent: PointerEvent) => {
            setPadding(moveOutpaintSource(start.padding, (moveEvent.clientX - start.x) / scale, (moveEvent.clientY - start.y) / scale));
        };
        const up = () => {
            document.removeEventListener("pointermove", move);
            document.removeEventListener("pointerup", up);
        };
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", up);
    };

    return (
        <Modal title={null} open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} width={980} centered destroyOnHidden>
            <div className="grid gap-5 lg:grid-cols-[minmax(360px,1fr)_320px]">
                <div className="flex min-h-[360px] items-center justify-center rounded-xl border p-4" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                    {output && sourceStyle ? (
                        <div
                            className="relative select-none"
                            style={{
                                width: output.width * preview,
                                height: output.height * preview,
                                backgroundColor: theme.node.fill,
                                backgroundImage: `linear-gradient(45deg, ${theme.node.stroke} 25%, transparent 25%), linear-gradient(-45deg, ${theme.node.stroke} 25%, transparent 25%), linear-gradient(45deg, transparent 75%, ${theme.node.stroke} 75%), linear-gradient(-45deg, transparent 75%, ${theme.node.stroke} 75%)`,
                                backgroundSize: "16px 16px",
                                backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
                            }}
                        >
                            <img src={dataUrl} alt="" draggable={false} className="absolute max-w-none cursor-grab active:cursor-grabbing" style={sourceStyle} onPointerDown={startMove} />
                            <div className="pointer-events-none absolute inset-0 border-2" style={{ borderColor: theme.node.activeStroke }}>
                                {handles.map((handle) => (
                                    <button key={handle} type="button" className="pointer-events-auto absolute size-3 rounded-full border" style={{ ...handleStyle(handle), background: theme.node.panel, borderColor: theme.node.activeStroke }} onPointerDown={(event) => startDrag(handle, event)} aria-label="调整扩图范围" />
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="text-sm" style={{ color: theme.node.muted }}>
                            读取中
                        </div>
                    )}
                </div>

                <div className="flex min-h-[360px] flex-col gap-5">
                    <div>
                        <h2 className="text-xl font-semibold">扩图</h2>
                        <div className="mt-2 text-sm opacity-60">{image && output ? `${image.width} x ${image.height} → ${output.width} x ${output.height}` : "读取中"}</div>
                        <div className="mt-1 text-xs" style={{ color: theme.node.muted }}>
                            棋盘格是蒙版区域，模型只在这里生成；拖动原图可调整它在扩图中的位置
                        </div>
                        {atMinSize ? (
                            <div className="mt-1 text-xs" style={{ color: theme.node.muted }}>
                                当前尺寸已达接口最小要求（{minSize?.width} x {minSize?.height}），不能再缩小
                            </div>
                        ) : atMaxSize ? (
                            <div className="mt-1 text-xs" style={{ color: theme.node.muted }}>
                                当前已达可生成尺寸上限
                            </div>
                        ) : null}
                    </div>

                    <div className="space-y-2">
                        <div className="text-sm font-medium opacity-75">扩展倍数</div>
                        <div className="grid grid-cols-3 gap-2">
                            {scaleOptions.map((scale) => (
                                <Button key={scale} type={activeScale === scale ? "primary" : "default"} onClick={() => image && setPadding(fitPadding(image.width, image.height, scaleOutpaintPadding(image.width, image.height, scale), model))}>
                                    {scale}x
                                </Button>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="text-sm font-medium opacity-75">目标比例</div>
                        <div className="grid grid-cols-3 gap-2">
                            {aspectOptions.map((item) => (
                                <Button key={item.value} type={activeAspect === item.value ? "primary" : "default"} onClick={() => image && setPadding(fitPadding(image.width, image.height, aspectOutpaintPadding(image.width, image.height, item.width, item.height), model))}>
                                    {item.value}
                                </Button>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="text-sm font-medium opacity-75">蒙版区域生成内容（可选）</div>
                        <Input.TextArea rows={5} value={prompt} placeholder="例如：不同品种的小猫。只生成在棋盘格扩边区域，原图保持不变。不填则延展背景。" onChange={(event) => setPrompt(event.target.value)} />
                    </div>

                    <div className="mt-auto flex items-center justify-between gap-2">
                        <Button icon={<RotateCcw className="size-4" />} onClick={() => image && setPadding(fitPadding(image.width, image.height, scaleOutpaintPadding(image.width, image.height, defaultScale), model))}>
                            重置
                        </Button>
                        <div className="flex items-center gap-2">
                            <Button icon={<X className="size-4" />} onClick={onClose}>
                                取消
                            </Button>
                            <Button type="primary" icon={<Expand className="size-4" />} disabled={!canExpand} onClick={() => canExpand && onConfirm({ prompt: prompt.trim(), padding })}>
                                扩图
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </Modal>
    );
}

function fitPadding(sourceWidth: number, sourceHeight: number, padding: ImageOutpaintPadding, model: string): ImageOutpaintPadding {
    const next = {
        top: Math.max(0, Math.round(padding.top)),
        right: Math.max(0, Math.round(padding.right)),
        bottom: Math.max(0, Math.round(padding.bottom)),
        left: Math.max(0, Math.round(padding.left)),
    };
    const width = sourceWidth + next.left + next.right;
    const height = sourceHeight + next.top + next.bottom;
    const clamped = clampImageSizeForModel(model, Math.max(sourceWidth, width), Math.max(sourceHeight, height));
    return redistributeOutpaintPadding(sourceWidth, sourceHeight, next, Math.max(sourceWidth, clamped.width), Math.max(sourceHeight, clamped.height));
}

function handleStyle(handle: ResizeHandle) {
    const top = handle.includes("n") ? "-6px" : handle.includes("s") ? "calc(100% - 6px)" : "calc(50% - 6px)";
    const left = handle.includes("w") ? "-6px" : handle.includes("e") ? "calc(100% - 6px)" : "calc(50% - 6px)";
    return { top, left, cursor: `${handle}-resize` };
}
