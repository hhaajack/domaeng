import type { ImageAttachment, JSONObject, JSONValue, TurnInputOptions } from "../types";
import { randomUUID } from "./base64";

const MAX_PAYLOAD_DIMENSION = 1600;
const PAYLOAD_QUALITY = 0.8;
const THUMBNAIL_SIZE = 70;
const THUMBNAIL_QUALITY = 0.8;

export async function makeImageAttachment(file: File): Promise<ImageAttachment> {
  const bitmap = await createImageBitmap(file);
  const payloadBlob = await renderJPEG(bitmap, {
    maxDimension: MAX_PAYLOAD_DIMENSION,
    quality: PAYLOAD_QUALITY,
    coverSquare: false
  });
  const thumbnailBlob = await renderJPEG(bitmap, {
    maxDimension: THUMBNAIL_SIZE,
    quality: THUMBNAIL_QUALITY,
    coverSquare: true
  });

  return {
    id: randomUUID(),
    thumbnailBase64JPEG: await blobToBase64(thumbnailBlob, false),
    payloadDataURL: await blobToBase64(payloadBlob, true),
    sourceURL: undefined
  };
}

export function makeTurnInputPayload({
  text,
  attachments,
  skillMentions = [],
  mentionMentions = [],
  imageURLKey = "url"
}: TurnInputOptions): JSONValue[] {
  const input: JSONValue[] = [];
  for (const attachment of attachments) {
    const payloadDataURL = attachment.payloadDataURL?.trim();
    if (!payloadDataURL) {
      continue;
    }
    input.push({
      type: "image",
      [imageURLKey]: payloadDataURL
    } as JSONObject);
  }

  const trimmedText = text.trim();
  if (trimmedText) {
    input.push({
      type: "text",
      text: trimmedText
    });
  }

  for (const mention of skillMentions) {
    const id = mention.id.trim();
    if (!id) {
      continue;
    }
    const payload: JSONObject = {
      type: "skill",
      id
    };
    if (mention.name?.trim()) {
      payload.name = mention.name.trim();
    }
    if (mention.path?.trim()) {
      payload.path = mention.path.trim();
    }
    input.push(payload);
  }

  for (const mention of mentionMentions) {
    const name = mention.name.trim();
    const path = mention.path.trim();
    if (!name || !path) {
      continue;
    }
    input.push({
      type: "mention",
      name,
      path
    });
  }

  return input;
}

async function renderJPEG(
  bitmap: ImageBitmap,
  options: { maxDimension: number; quality: number; coverSquare: boolean }
): Promise<Blob> {
  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;
  const longest = Math.max(sourceWidth, sourceHeight);
  const scale = options.coverSquare
    ? Math.max(options.maxDimension / sourceWidth, options.maxDimension / sourceHeight)
    : Math.min(1, options.maxDimension / longest);
  const targetWidth = options.coverSquare ? options.maxDimension : Math.max(1, Math.floor(sourceWidth * scale));
  const targetHeight = options.coverSquare ? options.maxDimension : Math.max(1, Math.floor(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not prepare image attachment");
  }
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, targetWidth, targetHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const offsetX = options.coverSquare ? (targetWidth - drawWidth) / 2 : 0;
  const offsetY = options.coverSquare ? (targetHeight - drawHeight) / 2 : 0;
  context.drawImage(bitmap, offsetX, offsetY, drawWidth, drawHeight);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Could not encode image attachment"));
      }
    }, "image/jpeg", options.quality);
  });
}

async function blobToBase64(blob: Blob, dataURL: boolean): Promise<string> {
  const reader = new FileReader();
  const result = new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read image attachment"));
  });
  reader.readAsDataURL(blob);
  const full = await result;
  return dataURL ? full : full.split(",", 2)[1] ?? "";
}
