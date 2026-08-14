import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { Button, Image, message } from 'antd'
import type { ChangeEvent } from 'react'
import { useRef } from 'react'
import { uploadImageFile } from '../services/api'

interface ImageUploadFieldProps {
  value?: unknown
  onChange?: (value: string[]) => void
  maxCount?: number
  readOnly?: boolean
  size?: number
  maxImageSize?: number
  quality?: number
}

function normalizeImageList(value: unknown) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (!value) return []
  try {
    const parsed = JSON.parse(String(value))
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []
  } catch {
    return []
  }
}

function createImageFallback(label = '图片') {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640">
      <rect width="640" height="640" rx="32" fill="#f3f4f6"/>
      <rect x="112" y="152" width="416" height="336" rx="24" fill="#ffffff" stroke="#d1d5db" stroke-width="8"/>
      <path d="M180 420l88-96 70 70 58-62 94 88H180z" fill="#dbeafe"/>
      <circle cx="422" cy="240" r="46" fill="#bfdbfe"/>
      <text x="320" y="548" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" fill="#6b7280">${label}</text>
    </svg>
  `
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function resolveImageSrc(src: string) {
  if (/^(data:image\/|https?:\/\/|\/assets\/|\/api\/uploads\/|blob:)/.test(src)) return src
  return createImageFallback()
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = src
  })
}

async function compressImage(file: File, maxImageSize: number, quality: number) {
  const dataUrl = await readFileAsDataUrl(file)
  if (!file.type.startsWith('image/')) return dataUrl

  const image = await loadImage(dataUrl)
  const ratio = Math.min(1, maxImageSize / Math.max(image.naturalWidth, image.naturalHeight))
  const width = Math.max(1, Math.round(image.naturalWidth * ratio))
  const height = Math.max(1, Math.round(image.naturalHeight * ratio))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return dataUrl
  context.drawImage(image, 0, 0, width, height)
  return canvas.toDataURL('image/jpeg', quality)
}

function dataUrlToFile(dataUrl: string, fileName: string) {
  const [metadata, payload] = dataUrl.split(',')
  const mimeType = metadata.match(/data:(.*?);/)?.[1] || 'image/jpeg'
  const binary = window.atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new File([bytes], fileName, { type: mimeType })
}

export function ImageUploadField({
  value = [],
  onChange,
  maxCount,
  readOnly = false,
  size = 84,
  maxImageSize = 1280,
  quality = 0.78,
}: ImageUploadFieldProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const imageList = normalizeImageList(value)
  const canUpload = !readOnly && (!maxCount || imageList.length < maxCount)

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return

    const remaining = maxCount ? Math.max(maxCount - imageList.length, 0) : files.length
    const acceptedFiles = files.slice(0, remaining)
    if (maxCount && files.length > remaining) {
      message.warning(`最多上传${maxCount}张图片`)
    }

    try {
      const images = await Promise.all(
        acceptedFiles.map(async (file) => {
          const compressed = await compressImage(file, maxImageSize, quality)
          const uploaded = await uploadImageFile(dataUrlToFile(compressed, file.name || 'image.jpg'))
          return uploaded.url
        }),
      )
      onChange?.([...imageList, ...images])
    } catch {
      message.error('图片处理失败，请重新选择图片')
    }
  }

  const removeImage = (index: number) => {
    onChange?.(imageList.filter((_, currentIndex) => currentIndex !== index))
  }

  if (readOnly && imageList.length === 0) {
    return <span className="image-upload-empty">暂无图片</span>
  }

  return (
    <div className="image-upload-field">
      {imageList.map((image, index) => {
        const src = resolveImageSrc(image)
        return (
          <div className="image-upload-thumb" style={{ width: size, height: size }} key={`${image}-${index}`}>
            <Image
              src={src}
              width={size}
              height={size}
              preview={{ src }}
              fallback={createImageFallback()}
              style={{ objectFit: 'cover' }}
            />
            {!readOnly && (
              <Button
                className="image-upload-remove"
                danger
                shape="circle"
                size="small"
                type="primary"
                icon={<DeleteOutlined />}
                onClick={() => removeImage(index)}
              />
            )}
          </div>
        )
      })}
      {canUpload && (
        <>
          <button
            className="image-upload-tile"
            style={{ width: size, height: size }}
            type="button"
            onClick={() => inputRef.current?.click()}
          >
            <PlusOutlined />
          </button>
          <input
            ref={inputRef}
            className="image-upload-input"
            multiple
            accept="image/*"
            type="file"
            onChange={handleFiles}
          />
        </>
      )}
    </div>
  )
}
