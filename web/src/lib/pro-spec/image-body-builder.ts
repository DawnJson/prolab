/**
 * 图像生成请求 body 构造器
 *
 * 按模型族（family）构造 /v1/images/generations（dalle 兼容协议）请求 body。
 *
 * 设计原则：
 * - 不无脑默认 size，让上游 default
 * - 字段按模型族官方支持清单透传，不支持的字段不发
 * - 同协议下的等价字段做命名转换（如 *→x、quality→resolution）
 *
 * 参考来源：
 * - DALL-E:        https://platform.openai.com/docs/api-reference/images
 * - gpt-image:     OpenAI 官方 + ProAPI 扩展 aspect_ratio
 * - Flux 2:        BFL 官方；OpenAI 兼容代理接受 size（自动转 width/height），不支持 aspect_ratio/quality/negative_prompt
 * - Grok Imagine:  https://docs.x.ai/developers/model-capabilities/images/generation （aspect_ratio + resolution，不接 size/quality/seed）
 * - Nano Banana:   Google Gemini imageConfig（OpenAI 兼容代理转发：size 仅 1K/2K/4K + aspect_ratio）
 * - Imagen 4:      Vertex AI（aspect_ratio + size 任意 WxH 或 1K/2K/4K + seed）
 * - Seedream:      ByteDance Volcano（size + quality + watermark + negative_prompt + seed + aspect_ratio）
 * - Qwen / Wan:    DashScope（size 用 x 分隔由中转转 *、negative_prompt、watermark、prompt_extend、thinking_mode）
 */

import type { ImageModelParams } from './types'

export type ImageModelFamily =
  | 'dalle'         // dall-e-2, dall-e-3
  | 'gpt-image'     // gpt-image-1(.5)*, gpt-image-2
  | 'flux'          // flux-2-pro, flux-2-max, flux-dev, flux-1-*
  | 'grok-imagine'  // grok-imagine
  | 'nano-banana'   // nano-banana, nano-banana-2, nano-banana-pro, gemini-2.5-flash-image
  | 'imagen'        // google-imagen-4, imagen-*
  | 'seedream'      // byte-plus-seedream-*, doubao-seedream-*
  | 'qwen'          // qwen-image, qwen-image-2(-pro), qwen-image-plus, wan2-7-image(-pro)
  | 'z-image'       // z-image-turbo
  | 'sora-image'    // sora_image, sora-image
  | 'gpt4o-image'   // gpt-4o（绘图模式）
  | 'agnes-image'   // agnes-image-2.0-flash, agnes-image-2.1-flash
  | 'hunyuan-image' // hunyuan-image-v3
  | 'unknown'

/**
 * 按模型名推断家族。顺序很重要：更精细的匹配在前。
 */
export function detectModelFamily(modelName: string): ImageModelFamily {
  const n = (modelName || '').toLowerCase()

  if (/^dall-e-/.test(n)) return 'dalle'
  if (/^gpt-image/.test(n)) return 'gpt-image'
  if (/^gpt-4o/.test(n)) return 'gpt4o-image'
  if (/^flux/.test(n)) return 'flux'
  if (/grok-imagine/.test(n)) return 'grok-imagine'
  if (/^google-imagen/.test(n) || /^imagen/.test(n)) return 'imagen'
  if (/nano-banana/.test(n) || /gemini.*image/.test(n)) return 'nano-banana'
  if (/^byte-plus-seedream/.test(n) || /^doubao-seedream/.test(n) || /seedream/.test(n)) return 'seedream'
  if (/^qwen-image/.test(n) || /^wan/.test(n)) return 'qwen'
  if (/^z-image/.test(n)) return 'z-image'
  if (/sora.?image/.test(n) || /^sora_image/.test(n)) return 'sora-image'
  if (/^agnes-image/.test(n)) return 'agnes-image'
  if (/^hunyuan.*image/.test(n)) return 'hunyuan-image'

  return 'unknown'
}

/**
 * 标准化 size 字符串：
 * - `1024*1024` → `1024x1024`（DashScope 风格 → OpenAI 标准）
 * - `1024X1024` → `1024x1024`（大写 X → 小写 x）
 * - `1k` / `2K` / `4 k` → `1K` / `2K` / `4K`（K 档位统一大写）
 */
export function normalizeSize(size: string): string {
  if (!size) return size
  let s = size.trim().replace(/\*/g, 'x').replace(/X/g, 'x')
  if (/^[1-4]\s*k$/i.test(s)) {
    s = s.replace(/\s+/g, '').toUpperCase()
  }
  return s
}

/** 判断 size 是否为 "AxB" 像素格式 */
export function isWxHSize(size: string): boolean {
  return /^\d+x\d+$/.test(size)
}

/** 判断 size 是否为 "1K"/"2K"/"4K" 档位 */
export function isKLevelSize(size: string): boolean {
  return /^[1-4]K$/.test(size)
}

interface BuildBodyOpts {
  modelName: string
  prompt: string
  modelParams?: ImageModelParams
  responseFormat?: 'url' | 'b64_json'
}

/**
 * 判断给定模型是否使用豆包私有协议（image 字段需要完整 data URL 而非纯 base64）。
 * 供 dalle.ts 垫图场景使用。
 */
export function isDoubaoSeedreamModel(modelName: string): boolean {
  const n = (modelName || '').toLowerCase()
  return /doubao/.test(n) || /^byte-plus-seedream/.test(n)
}

/**
 * 判断是否为 Flux 模型（决定走 multipart edits 还是 json generations）。
 */
export function isFluxModel(modelName: string): boolean {
  return /flux/i.test(modelName || '')
}

/**
 * 构造 dalle 兼容端点（/v1/images/generations 或 /v1/images/edits）请求 body。
 *
 * 不包含 image 字段，垫图场景由调用方追加。
 */
export function buildDalleEndpointBody(opts: BuildBodyOpts): Record<string, any> {
  const { modelName, prompt, modelParams, responseFormat = 'url' } = opts
  const family = detectModelFamily(modelName)
  const p = modelParams || {}

  // sampleCount > 1 时映射到上游 `n`（单 Task 多图模式）。
  // 注意：前端「生成数量」走的是「并发分发多个独立 Task」模式（详见 studio.vue），
  // 每个 Task 的 modelParams.sampleCount 应为 1，避免被上游再批量一次造成双重计费。
  // 这里保留对显式 sampleCount > 1 的支持，便于未来上层切换为单 Task 批量模式。
  const body: Record<string, any> = {
    model: modelName,
    prompt,
    n: p.sampleCount && p.sampleCount > 1 ? p.sampleCount : 1,
  }
  if (family !== 'agnes-image') body.response_format = responseFormat

  switch (family) {
    case 'dalle': {
      // DALL-E 3：size + quality(standard|hd) + style(vivid|natural)
      if (p.size) body.size = normalizeSize(p.size)
      if (p.quality === 'standard' || p.quality === 'hd') body.quality = p.quality
      if (p.style) body.style = p.style
      break
    }

    case 'gpt-image': {
      // gpt-image-2：
      //   size(auto + WxH，16 倍数 / 0.65M-8.3M 像素), quality(auto|low|medium|high),
      //   background, output_format(png|jpeg|webp), output_compression（仅 jpeg/webp）, moderation(auto|low), input_fidelity(low|high)
      // 像素级 size 已完整表达比例；仅在没有 size 时保留 ProAPI aspect_ratio 扩展兜底，避免编辑端点重复处理比例后裁剪画面。
      if (p.size) body.size = normalizeSize(p.size)
      if (p.quality) body.quality = p.quality
      if (!p.size && p.aspectRatio) body.aspect_ratio = p.aspectRatio
      if (p.background && p.background !== 'auto') body.background = p.background
      if (p.outputFormat) body.output_format = p.outputFormat
      if (
        p.outputCompression !== undefined
        && p.outputFormat
        && p.outputFormat !== 'png'
      ) {
        body.output_compression = p.outputCompression
      }
      if (p.moderation) body.moderation = p.moderation
      if (p.inputFidelity) body.input_fidelity = p.inputFidelity
      break
    }

    case 'flux': {
      // Flux 2 通过 OpenAI 兼容代理：size(WxH，中转转 width/height) + seed + output_format
      // 不支持：aspect_ratio / quality / negative_prompt
      if (p.size && isWxHSize(normalizeSize(p.size))) {
        body.size = normalizeSize(p.size)
      }
      if (p.seed !== undefined && p.seed !== -1) body.seed = p.seed
      if (p.outputFormat) body.output_format = p.outputFormat
      break
    }

    case 'grok-imagine': {
      // Grok Imagine 官方仅支持：aspect_ratio + resolution(1k|2k) + n
      // 前端用 quality 字段填 1k/2k，转换为官方的 resolution 字段
      // 不支持：size / quality(原名) / seed / negative_prompt
      if (p.aspectRatio) body.aspect_ratio = p.aspectRatio
      if (p.quality && /^[1-2]k$/i.test(p.quality)) {
        body.resolution = p.quality.toLowerCase()
      }
      break
    }

    case 'nano-banana': {
      // Nano Banana（Gemini Flash Image，经 New-API OpenAI 兼容透传）：
      // 实测上游只认 OpenAI 标准像素级 size（WxH，精确遵循，支持到 4K/超大），
      // 不认比例字符串 / aspect_ratio / image_size / quality。故仅透传像素 size。
      if (p.size) body.size = normalizeSize(p.size)
      break
    }

    case 'imagen': {
      // Imagen 4：aspect_ratio + size(WxH 或 1K/2K/4K) + seed + n(1-4)
      if (p.aspectRatio) body.aspect_ratio = p.aspectRatio
      if (p.size) body.size = normalizeSize(p.size)
      if (p.seed !== undefined && p.seed !== -1) body.seed = p.seed
      break
    }

    case 'seedream': {
      // Seedream 4.5（byte-plus-seedream-* / doubao-seedream-*）：
      //   size(1K/2K/4K 或 WxH) + quality(standard|hd|high) + aspect_ratio + seed +
      //   watermark + negative_prompt
      //   guidance_scale 仅老版 doubao-seedream-3-* 的 t2i 模型支持
      if (p.size) body.size = normalizeSize(p.size)
      if (p.quality) body.quality = p.quality
      if (p.aspectRatio) body.aspect_ratio = p.aspectRatio
      if (p.seed !== undefined && p.seed !== -1) body.seed = p.seed
      if (p.watermark !== undefined) body.watermark = p.watermark
      if (p.negativePrompt) body.negative_prompt = p.negativePrompt
      if (
        p.guidanceScale !== undefined
        && /^doubao-seedream-3/.test(modelName.toLowerCase())
      ) {
        body.guidance_scale = p.guidanceScale
      }
      break
    }

    case 'qwen': {
      // Qwen-image / Wan 2.7：
      //   size(用 x 分隔，由中转层转 *) + negative_prompt + watermark + seed + prompt_extend
      //   thinking_mode 仅 wan2.7-image / wan2.7-image-pro 支持
      if (p.size) body.size = normalizeSize(p.size)
      if (p.negativePrompt) body.negative_prompt = p.negativePrompt
      if (p.watermark !== undefined) body.watermark = p.watermark
      if (p.seed !== undefined && p.seed !== -1) body.seed = p.seed
      if (p.promptExtend !== undefined) body.prompt_extend = p.promptExtend
      if (
        p.thinkingMode !== undefined
        && /^wan2[-.]7-image/.test(modelName.toLowerCase())
      ) {
        body.thinking_mode = p.thinkingMode
      }
      break
    }

    case 'z-image': {
      // Z-Image：仅 negative_prompt
      if (p.negativePrompt) body.negative_prompt = p.negativePrompt
      break
    }

    case 'sora-image': {
      // Sora 通过 dalle 协议绘图：仅基础参数
      break
    }

    case 'agnes-image': {
      // Agnes 绘图（agnes-image-2.0-flash / 2.1-flash）：纯文生图，
      // 实测 LiteLLM 上游不支持 response_format/size/quality，仅发送基础 model/prompt/n
      break
    }
    case 'hunyuan-image': {
      // Hunyuan Image 在 ProAPI 中按 OpenAI Images 兼容端点调用，不走 chat。
      // 只透传通用 size/quality，避免把 chat completions 扩展字段带入 images 端点。
      if (p.size) body.size = normalizeSize(p.size)
      if (p.quality) body.quality = p.quality
      break
    }
    case 'gpt4o-image': {
      // gpt-4o 通常走 openai-chat；若走 dalle 协议则仅透传 size/quality
      if (p.size) body.size = normalizeSize(p.size)
      if (p.quality) body.quality = p.quality
      break
    }

    case 'unknown': {
      // 未知模型族：保守透传通用 OpenAI 字段
      if (p.size) body.size = normalizeSize(p.size)
      if (p.quality) body.quality = p.quality
      break
    }
  }

  return body
}

/**
 * 构造 openai-chat 端点（/v1/chat/completions）请求 body 的扩展字段。
 *
 * chat completions 协议主体是 messages，但 ProAPI 中转层会读取顶层 size/aspect_ratio/quality
 * 等字段并转发给绘图后端（gpt4o-image / sora-image / grok-image / qwen-image 走 chat 时）。
 *
 * 此函数返回需要追加到 body 的扩展字段集合，调用方将其展开到 body 中即可。
 */
export function buildOpenAIChatImageExtras(opts: {
  modelName: string
  modelParams?: ImageModelParams
}): Record<string, any> {
  const { modelName, modelParams } = opts
  const family = detectModelFamily(modelName)
  const p = modelParams || {}
  const extras: Record<string, any> = {}

  // 通用：size / aspect_ratio / quality（chat 端点中转层一般识别）
  if (p.size) extras.size = normalizeSize(p.size)
  if (p.aspectRatio) extras.aspect_ratio = p.aspectRatio
  if (p.quality) extras.quality = p.quality
  if (p.n && p.n > 1) extras.n = p.n
  if (p.sampleCount && p.sampleCount > 1) extras.n = p.sampleCount

  // 按家族补充扩展字段
  switch (family) {
    case 'gpt-image':
    case 'gpt4o-image': {
      if (p.background && p.background !== 'auto') extras.background = p.background
      if (p.outputFormat) extras.output_format = p.outputFormat
      if (
        p.outputCompression !== undefined
        && p.outputFormat
        && p.outputFormat !== 'png'
      ) {
        extras.output_compression = p.outputCompression
      }
      if (p.moderation) extras.moderation = p.moderation
      if (p.inputFidelity) extras.input_fidelity = p.inputFidelity
      break
    }
    case 'grok-imagine': {
      // chat 端点下 Grok 优先识别 aspect_ratio + resolution
      if (p.quality && /^[1-2]k$/i.test(p.quality)) {
        extras.resolution = p.quality.toLowerCase()
        // 删除上面通用透传的 quality，避免上游报"未知字段"
        delete extras.quality
      }
      // chat 端点 Grok 不接 size
      delete extras.size
      break
    }
    case 'nano-banana': {
      // size 仅 1K/2K/4K
      if (extras.size && !isKLevelSize(extras.size)) {
        delete extras.size
      }
      // quality 不支持
      delete extras.quality
      break
    }
  }

  return extras
}
