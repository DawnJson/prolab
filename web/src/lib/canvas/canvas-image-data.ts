export type ImageCropRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type ImageAngleTransform = {
    horizontalAngle: number;
    pitchAngle: number;
    cameraDistance: number;
    wideAngle: boolean;
};

export type ImageUpscaleAlgorithm = "nearest" | "bilinear" | "high";

export const MAX_UPSCALE_LONG_EDGE = 4096;

export type ImageUpscaleParams = {
    targetLongEdge: number;
    algorithm: ImageUpscaleAlgorithm;
};

export type ImageSplitParams = {
    rows: number;
    columns: number;
    horizontalLines?: number[];
    verticalLines?: number[];
};

export type ImageSplitPiece = {
    row: number;
    column: number;
    dataUrl: string;
};

export type ImageOutpaintPadding = {
    top: number;
    right: number;
    bottom: number;
    left: number;
};

export type ImageOutpaintLayout = ImageOutpaintPadding & {
    width: number;
    height: number;
    sourceWidth: number;
    sourceHeight: number;
    imageDataUrl: string;
    maskDataUrl: string;
};

type OutpaintBox = Pick<ImageOutpaintLayout, "left" | "top" | "right" | "bottom" | "sourceWidth" | "sourceHeight">;

export function outpaintBlendPx(sourceWidth: number, sourceHeight: number) {
    return Math.max(16, Math.min(64, Math.floor(Math.min(sourceWidth, sourceHeight) / 8)));
}

export function distanceToOutpaintSeam(x: number, y: number, layout: OutpaintBox) {
    const x0 = layout.left;
    const y0 = layout.top;
    const x1 = x0 + layout.sourceWidth;
    const y1 = y0 + layout.sourceHeight;
    if (x < x0 || x >= x1 || y < y0 || y >= y1) return null;
    let dist = Infinity;
    if (layout.left > 0) dist = Math.min(dist, x - x0);
    if (layout.right > 0) dist = Math.min(dist, x1 - x);
    if (layout.top > 0) dist = Math.min(dist, y - y0);
    if (layout.bottom > 0) dist = Math.min(dist, y1 - y);
    return dist;
}

export function outpaintMaskKeepAlpha(x: number, y: number, layout: OutpaintBox, overlap: number) {
    const dist = distanceToOutpaintSeam(x, y, layout);
    if (dist == null) return 0;
    if (!Number.isFinite(dist) || dist >= overlap) return 255;
    return 0;
}

export function outpaintCompositeWeight(x: number, y: number, layout: OutpaintBox, feather: number) {
    const dist = distanceToOutpaintSeam(x, y, layout);
    if (dist == null) return 0;
    if (!Number.isFinite(dist) || feather <= 0) return 1;
    const t = Math.max(0, Math.min(1, dist / feather));
    return t * t * (3 - 2 * t);
}

export function buildOutpaintPrompt(userPrompt = "") {
    const extra = userPrompt.trim();
    if (extra) {
        return `只在图像透明空白的扩边蒙版区域生成：${extra}。原图矩形内必须保持原样、不要重绘，也不要把新主体画进原图。新主体必须完整落在蒙版区域内。`;
    }
    return "只在图像透明空白的扩边蒙版区域延续同一场景的背景、地面、墙面、光影和透视。原图矩形内保持不变，不要新增人物、动物或物体。";
}

export function centerOutpaintPadding(sourceWidth: number, sourceHeight: number, outputWidth: number, outputHeight: number): ImageOutpaintPadding {
    const extraW = Math.max(0, Math.round(outputWidth) - sourceWidth);
    const extraH = Math.max(0, Math.round(outputHeight) - sourceHeight);
    const left = Math.floor(extraW / 2);
    const top = Math.floor(extraH / 2);
    return { left, right: extraW - left, top, bottom: extraH - top };
}

export function scaleOutpaintPadding(sourceWidth: number, sourceHeight: number, scale: number): ImageOutpaintPadding {
    const width = Math.max(sourceWidth, Math.round(sourceWidth * scale));
    const height = Math.max(sourceHeight, Math.round(sourceHeight * scale));
    return centerOutpaintPadding(sourceWidth, sourceHeight, width, height);
}

export function aspectOutpaintPadding(sourceWidth: number, sourceHeight: number, ratioWidth: number, ratioHeight: number): ImageOutpaintPadding {
    const targetAspect = ratioWidth / Math.max(1, ratioHeight);
    const sourceAspect = sourceWidth / Math.max(1, sourceHeight);
    const width = targetAspect >= sourceAspect ? Math.max(sourceWidth, Math.round(sourceHeight * targetAspect)) : sourceWidth;
    const height = targetAspect >= sourceAspect ? sourceHeight : Math.max(sourceHeight, Math.round(sourceWidth / targetAspect));
    return centerOutpaintPadding(sourceWidth, sourceHeight, width, height);
}

export function redistributeOutpaintPadding(sourceWidth: number, sourceHeight: number, padding: ImageOutpaintPadding, outputWidth: number, outputHeight: number): ImageOutpaintPadding {
    const extraW = Math.max(0, outputWidth - sourceWidth);
    const extraH = Math.max(0, outputHeight - sourceHeight);
    const horizontal = Math.max(0, padding.left + padding.right);
    const vertical = Math.max(0, padding.top + padding.bottom);
    const left = horizontal > 0 ? Math.round(extraW * (padding.left / horizontal)) : Math.floor(extraW / 2);
    const top = vertical > 0 ? Math.round(extraH * (padding.top / vertical)) : Math.floor(extraH / 2);
    return {
        left: Math.min(extraW, Math.max(0, left)),
        right: extraW - Math.min(extraW, Math.max(0, left)),
        top: Math.min(extraH, Math.max(0, top)),
        bottom: extraH - Math.min(extraH, Math.max(0, top)),
    };
}

export function moveOutpaintSource(padding: ImageOutpaintPadding, dx: number, dy: number): ImageOutpaintPadding {
    const extraW = Math.max(0, padding.left + padding.right);
    const extraH = Math.max(0, padding.top + padding.bottom);
    const left = Math.min(extraW, Math.max(0, Math.round(padding.left + dx)));
    const top = Math.min(extraH, Math.max(0, Math.round(padding.top + dy)));
    return { left, right: extraW - left, top, bottom: extraH - top };
}

function fillOutpaintEdgeContext(context: CanvasRenderingContext2D, image: HTMLImageElement, left: number, top: number, right: number, bottom: number) {
    const sw = image.width;
    const sh = image.height;
    if (top > 0) context.drawImage(image, 0, 0, sw, 1, left, 0, sw, top);
    if (bottom > 0) context.drawImage(image, 0, sh - 1, sw, 1, left, top + sh, sw, bottom);
    if (left > 0) context.drawImage(image, 0, 0, 1, sh, 0, top, left, sh);
    if (right > 0) context.drawImage(image, sw - 1, 0, 1, sh, left + sw, top, right, sh);
    if (top > 0 && left > 0) context.drawImage(image, 0, 0, 1, 1, 0, 0, left, top);
    if (top > 0 && right > 0) context.drawImage(image, sw - 1, 0, 1, 1, left + sw, 0, right, top);
    if (bottom > 0 && left > 0) context.drawImage(image, 0, sh - 1, 1, 1, 0, top + sh, left, bottom);
    if (bottom > 0 && right > 0) context.drawImage(image, sw - 1, sh - 1, 1, 1, left + sw, top + sh, right, bottom);
    context.drawImage(image, left, top);
}

export async function composeOutpaintCanvas(dataUrl: string, padding: ImageOutpaintPadding, options?: { contextFill?: "edge" | "empty" }): Promise<ImageOutpaintLayout> {
    const image = await loadImage(dataUrl);
    const left = Math.max(0, Math.round(padding.left));
    const right = Math.max(0, Math.round(padding.right));
    const top = Math.max(0, Math.round(padding.top));
    const bottom = Math.max(0, Math.round(padding.bottom));
    const width = image.width + left + right;
    const height = image.height + top + bottom;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    const context = canvas.getContext("2d");
    if (!context) {
        return { imageDataUrl: dataUrl, maskDataUrl: dataUrl, width: image.width, height: image.height, sourceWidth: image.width, sourceHeight: image.height, left: 0, top: 0, right: 0, bottom: 0 };
    }
    if (options?.contextFill === "empty") {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, left, top);
    } else {
        fillOutpaintEdgeContext(context, image, left, top, right, bottom);
    }
    const box: OutpaintBox = { left, top, right, bottom, sourceWidth: image.width, sourceHeight: image.height };
    const overlap = options?.contextFill === "empty" ? 0 : outpaintBlendPx(image.width, image.height);
    const mask = document.createElement("canvas");
    mask.width = canvas.width;
    mask.height = canvas.height;
    const maskContext = mask.getContext("2d");
    if (maskContext) {
        maskContext.fillStyle = "#fff";
        maskContext.fillRect(0, 0, mask.width, mask.height);
        const pixels = maskContext.getImageData(0, 0, mask.width, mask.height);
        const data = pixels.data;
        for (let y = 0; y < mask.height; y++) {
            for (let x = 0; x < mask.width; x++) {
                data[(y * mask.width + x) * 4 + 3] = outpaintMaskKeepAlpha(x, y, box, overlap);
            }
        }
        maskContext.putImageData(pixels, 0, 0);
    }
    return {
        imageDataUrl: canvas.toDataURL("image/png"),
        maskDataUrl: (maskContext ? mask : canvas).toDataURL("image/png"),
        width: canvas.width,
        height: canvas.height,
        sourceWidth: image.width,
        sourceHeight: image.height,
        left,
        top,
        right,
        bottom,
    };
}

export async function applyOutpaintOriginal(generatedDataUrl: string, originalDataUrl: string, layout: ImageOutpaintLayout) {
    const generated = await loadImage(generatedDataUrl);
    const original = await loadImage(originalDataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = generated.width;
    canvas.height = generated.height;
    const context = canvas.getContext("2d");
    if (!context) return generatedDataUrl;
    context.drawImage(generated, 0, 0);
    const scaleX = generated.width / Math.max(1, layout.width);
    const scaleY = generated.height / Math.max(1, layout.height);
    context.drawImage(original, layout.left * scaleX, layout.top * scaleY, layout.sourceWidth * scaleX, layout.sourceHeight * scaleY);
    return canvas.toDataURL("image/png");
}

export async function cropDataUrl(dataUrl: string, crop?: ImageCropRect) {
    const image = await loadImage(dataUrl);
    if (crop) {
        return drawCrop(image, Math.floor(crop.x * image.width), Math.floor(crop.y * image.height), Math.ceil(crop.width * image.width), Math.ceil(crop.height * image.height));
    }
    const size = Math.min(image.width, image.height);
    const sx = Math.max(0, Math.floor((image.width - size) / 2));
    const sy = Math.max(0, Math.floor((image.height - size) / 2));
    return drawCrop(image, sx, sy, size, size);
}

export async function splitDataUrl(dataUrl: string, params: ImageSplitParams): Promise<ImageSplitPiece[]> {
    const image = await loadImage(dataUrl);
    const xCuts = buildSplitCuts(params.verticalLines, image.width, Math.max(1, Math.floor(params.columns)));
    const yCuts = buildSplitCuts(params.horizontalLines, image.height, Math.max(1, Math.floor(params.rows)));
    const pieces: ImageSplitPiece[] = [];

    for (let row = 0; row < yCuts.length - 1; row += 1) {
        const sy = yCuts[row];
        const sh = yCuts[row + 1] - sy;
        for (let column = 0; column < xCuts.length - 1; column += 1) {
            const sx = xCuts[column];
            const sw = xCuts[column + 1] - sx;
            pieces.push({ row, column, dataUrl: drawCrop(image, sx, sy, sw, sh) });
        }
    }

    return pieces;
}

function buildSplitCuts(lines: number[] | undefined, size: number, count: number) {
    if (!lines?.length) return Array.from({ length: count + 1 }, (_, index) => Math.floor((index * size) / count));
    return [0, ...lines.map((line) => Math.round(line * size)).filter((line) => line > 0 && line < size).sort((a, b) => a - b), size];
}

export async function transformAngleDataUrl(dataUrl: string, params: ImageAngleTransform) {
    const image = await loadImage(dataUrl);
    const canvas = document.createElement("canvas");
    const padding = Math.round(Math.max(image.width, image.height) * 0.18);
    canvas.width = image.width + padding * 2;
    canvas.height = image.height + padding * 2;
    const context = canvas.getContext("2d");
    if (!context) return dataUrl;
    context.clearRect(0, 0, canvas.width, canvas.height);

    const horizontal = params.horizontalAngle / 60;
    const pitch = params.pitchAngle / 45;
    const distanceScale = 1.12 - params.cameraDistance * 0.035;
    const wideScale = params.wideAngle ? 0.88 : 1;
    const scale = Math.max(0.64, Math.min(1.1, distanceScale * wideScale));
    const width = image.width * scale * (1 - Math.abs(horizontal) * 0.28);
    const height = image.height * scale * (1 - Math.abs(pitch) * 0.18);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const skewX = horizontal * image.width * 0.18;
    const skewY = pitch * image.height * 0.12;
    const x = cx - width / 2 + horizontal * padding * 0.5;
    const y = cy - height / 2 + pitch * padding * 0.45;

    context.save();
    context.setTransform(1, pitch * 0.08, horizontal * -0.1, 1, 0, 0);
    context.drawImage(image, x + skewX, y + skewY, width, height);
    context.restore();

    if (params.wideAngle) {
        const gradient = context.createRadialGradient(cx, cy, Math.min(canvas.width, canvas.height) * 0.2, cx, cy, Math.max(canvas.width, canvas.height) * 0.62);
        gradient.addColorStop(0, "rgba(255,255,255,0)");
        gradient.addColorStop(1, "rgba(0,0,0,0.18)");
        context.fillStyle = gradient;
        context.fillRect(0, 0, canvas.width, canvas.height);
    }

    return canvas.toDataURL("image/png");
}

export async function upscaleDataUrl(dataUrl: string, params: ImageUpscaleParams) {
    const image = await loadImage(dataUrl);
    const { width, height } = resolveUpscaleSize(image.width, image.height, params.targetLongEdge);
    return params.algorithm === "high" ? drawStepUpscale(image, width, height) : drawResize(image, image.width, image.height, width, height, params.algorithm);
}

export function resolveUpscaleSize(width: number, height: number, targetLongEdge: number) {
    const longEdge = Math.max(1, width, height);
    const target = Math.min(MAX_UPSCALE_LONG_EDGE, Math.max(1, Math.round(targetLongEdge)));
    const scale = target / longEdge;
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function drawCrop(image: HTMLImageElement, sx: number, sy: number, sw: number, sh: number) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, sw);
    canvas.height = Math.max(1, sh);
    const context = canvas.getContext("2d");
    if (!context) return image.src;
    context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
}

function drawStepUpscale(image: HTMLImageElement, width: number, height: number) {
    let source: CanvasImageSource = image;
    let sourceWidth = image.width;
    let sourceHeight = image.height;

    while (sourceWidth * 2 < width && sourceHeight * 2 < height) {
        const nextWidth = sourceWidth * 2;
        const nextHeight = sourceHeight * 2;
        const next = drawResizeCanvas(source, sourceWidth, sourceHeight, nextWidth, nextHeight, "high");
        source = next;
        sourceWidth = nextWidth;
        sourceHeight = nextHeight;
    }

    return drawResize(source, sourceWidth, sourceHeight, width, height, "high");
}

function drawResize(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, width: number, height: number, algorithm: ImageUpscaleAlgorithm) {
    return drawResizeCanvas(source, sourceWidth, sourceHeight, width, height, algorithm).toDataURL("image/png");
}

function drawResizeCanvas(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, width: number, height: number, algorithm: ImageUpscaleAlgorithm) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return canvas;
    context.imageSmoothingEnabled = algorithm !== "nearest";
    context.imageSmoothingQuality = algorithm === "bilinear" ? "medium" : "high";
    context.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);
    return canvas;
}

function loadImage(dataUrl: string) {
    return new Promise<HTMLImageElement>((resolve) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.src = dataUrl;
    });
}
