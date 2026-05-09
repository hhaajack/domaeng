import { describe, expect, it } from "vitest";
import { makeTurnInputPayload } from "./attachments";

describe("turn input payload", () => {
  it("encodes image attachments before text", () => {
    expect(makeTurnInputPayload({
      text: "hello",
      attachments: [{
        id: "image-1",
        thumbnailBase64JPEG: "thumb",
        payloadDataURL: "data:image/jpeg;base64,payload"
      }]
    })).toEqual([
      {
        type: "image",
        url: "data:image/jpeg;base64,payload"
      },
      {
        type: "text",
        text: "hello"
      }
    ]);
  });

  it("supports the image_url fallback field", () => {
    expect(makeTurnInputPayload({
      text: "",
      attachments: [{
        id: "image-1",
        thumbnailBase64JPEG: "thumb",
        payloadDataURL: "data:image/jpeg;base64,payload"
      }],
      imageURLKey: "image_url"
    })).toEqual([
      {
        type: "image",
        image_url: "data:image/jpeg;base64,payload"
      }
    ]);
  });

  it("encodes structured skill and plugin mention items after text", () => {
    expect(makeTurnInputPayload({
      text: "Use $imagegen and @browser-use",
      attachments: [],
      skillMentions: [{
        id: "imagegen",
        name: "imagegen",
        path: "/Users/me/.codex/skills/.system/imagegen/SKILL.md"
      }],
      mentionMentions: [{
        name: "browser-use",
        path: "plugin://browser-use@openai-bundled"
      }]
    })).toEqual([
      {
        type: "text",
        text: "Use $imagegen and @browser-use"
      },
      {
        type: "skill",
        id: "imagegen",
        name: "imagegen",
        path: "/Users/me/.codex/skills/.system/imagegen/SKILL.md"
      },
      {
        type: "mention",
        name: "browser-use",
        path: "plugin://browser-use@openai-bundled"
      }
    ]);
  });
});
