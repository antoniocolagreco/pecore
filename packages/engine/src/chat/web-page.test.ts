import { Readable } from "node:stream";
import type { IncomingHttpHeaders, IncomingMessage, RequestOptions } from "node:http";
import { beforeEach, expect, it, vi } from "vitest";
import { readWebPage } from "./web-page";

const { lookup, request } = vi.hoisted(() => ({
  lookup: vi.fn<(host: string) => Promise<{ address: string; family: number }[]>>(),
  request: vi.fn<(options: RequestOptions, respond: (message: IncomingMessage) => void) => { once: () => { end: () => void } }>(),
}));
vi.mock("node:dns/promises", () => ({ lookup }));
vi.mock("node:http", () => ({ request }));
vi.mock("node:https", () => ({ request }));

function reply(statusCode: number, headers: IncomingHttpHeaders, data: Buffer[] = []): void {
  request.mockImplementationOnce((_opts, respond) => ({
    once: () => ({ end: () => respond(Object.assign(Readable.from(data), { statusCode, headers }) as IncomingMessage) }),
  }));
}

beforeEach(() => {
  request.mockReset();
  lookup.mockReset();
});

it("checks each redirect and pins the connection to a public address with the original host", async () => {
  lookup.mockResolvedValueOnce([{ address: "1.1.1.1", family: 4 }]).mockResolvedValueOnce([{ address: "2606:4700::1", family: 6 }]);
  reply(302, { location: "https://docs.example.net/request?version=2" });
  reply(200, { "content-type": "text/html; charset=utf-8" }, [Buffer.from("<p>Use the workspace.</p>")]);
  await expect(readWebPage("https://example.com/old")).resolves.toEqual({
    url: "https://docs.example.net/request?version=2", contentType: "text/html", body: "<p>Use the workspace.</p>", truncated: false, untrusted: true,
  });
  expect(lookup.mock.calls.map(([host]) => host)).toEqual(["example.com", "docs.example.net"]);
  expect(request.mock.calls.map(([options]) => options)).toMatchObject([
    { hostname: "1.1.1.1", headers: { host: "example.com" }, servername: "example.com", path: "/old" },
    { hostname: "2606:4700::1", headers: { host: "docs.example.net" }, servername: "docs.example.net", path: "/request?version=2" },
  ]);
});

it.each(["http://127.0.0.1/", "http://[::ffff:169.254.169.254]/", "file:///etc/passwd", "https://name:secret@example.com/"])("rejects %s before connecting", async (url) => {
  await expect(readWebPage(url)).rejects.toThrow(/public HTTP|public web/);
  expect(request).not.toHaveBeenCalled();
});

it("rejects redirects to hosts resolving to private addresses", async () => {
  lookup.mockResolvedValueOnce([{ address: "1.1.1.1", family: 4 }]).mockResolvedValueOnce([{ address: "192.168.0.5", family: 4 }]);
  reply(302, { location: "http://internal.example.net/latest" });
  await expect(readWebPage("http://example.com/")).rejects.toThrow(/public web/);
  expect(request).toHaveBeenCalledTimes(1);
});

it("rejects non-text responses and clips oversized text", async () => {
  lookup.mockResolvedValue([{ address: "1.1.1.1", family: 4 }]);
  reply(200, { "content-type": "image/png" });
  await expect(readWebPage("http://example.com/image")).rejects.toThrow(/text page/);
  reply(200, { "content-type": "text/plain" }, [Buffer.alloc(180_000, 65), Buffer.alloc(21_000, 66)]);
  const result = await readWebPage("http://example.com/docs");
  expect(result.truncated).toBe(true);
  expect(result.body).toBe("A".repeat(180_000) + "B".repeat(20_000));
});

it("stops redirect loops and reports unavailable pages", async () => {
  lookup.mockResolvedValue([{ address: "1.1.1.1", family: 4 }]);
  for (let attempt: number = 0; attempt < 5; attempt++) reply(302, { location: "/" });
  await expect(readWebPage("http://example.com/")).rejects.toThrow(/redirected too many times/);
  expect(request).toHaveBeenCalledTimes(5);
  reply(404, { "content-type": "text/plain" });
  await expect(readWebPage("http://example.com/missing")).rejects.toThrow(/HTTP 404/);
});
