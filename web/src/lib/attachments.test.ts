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
});
