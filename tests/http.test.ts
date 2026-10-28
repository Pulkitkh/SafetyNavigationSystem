import { describe, expect, it } from "vitest";
import { ApiError, readLimited } from "@/lib/server/http";

describe("request body limit", () => {
  it("reads normal bodies", async () => {
    expect(await readLimited(new Request("http://x/", { method: "POST", body: '{"a":1}' }))).toBe('{"a":1}');
  });

  it("rejects bodies over the limit, declared or streamed", async () => {
    const big = "x".repeat(2000);
    await expect(readLimited(new Request("http://x/", { method: "POST", body: big }), 1000)).rejects.toMatchObject({ status: 413 });
    const stream = new ReadableStream({
      start(c) {
        for (let i = 0; i < 5; i++) c.enqueue(new TextEncoder().encode("y".repeat(400)));
        c.close();
      },
    });
    const req = new Request("http://x/", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    await expect(readLimited(req, 1000)).rejects.toBeInstanceOf(ApiError);
  });
});
