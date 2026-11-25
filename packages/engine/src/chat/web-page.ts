import { lookup } from "node:dns/promises";
import { request as requestHttp } from "node:http";
import type { IncomingMessage } from "node:http";
import { request as requestHttps } from "node:https";
import type { RequestOptions } from "node:https";
import { BlockList, isIP } from "node:net";
import { checkServerIdentity } from "node:tls";

const maxBytes: number = 200_000;
const redirects: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
const privateV4: BlockList = new BlockList();
const ipv4Ranges: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3],
];
for (const [address, bits] of ipv4Ranges) privateV4.addSubnet(address, bits);
const globalV6: BlockList = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const specialV6: BlockList = new BlockList();
specialV6.addSubnet("2001::", 23, "ipv6");
specialV6.addSubnet("2001:db8::", 32, "ipv6");
specialV6.addSubnet("2002::", 16, "ipv6");

function publicAddress(address: string, family: number): boolean {
  return family === 4 ? !privateV4.check(address) : globalV6.check(address, "ipv6") && !specialV6.check(address, "ipv6");
}

function webUrl(input: string, base?: URL): URL {
  const url: URL = new URL(input, base);
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    throw new Error("Use a public HTTP or HTTPS link without embedded credentials.");
  }
  return url;
}

async function responseFor(url: URL, signal: AbortSignal): Promise<IncomingMessage> {
  const host: string = url.hostname.replace(/^\[|\]$/g, "");
  const family: number = isIP(host);
  const addresses: { address: string; family: number }[] = family ? [{ address: host, family }] : await lookup(host, { all: true });
  const target: { address: string; family: number } | undefined = addresses.find(({ address, family }) => publicAddress(address, family));
  if (!target) throw new Error("Only public web addresses can be read here.");
  const request: typeof requestHttp = url.protocol === "https:" ? requestHttps : requestHttp;
  const options: RequestOptions = {
    hostname: target.address, family: target.family, port: url.port || undefined, path: url.pathname + url.search,
    headers: { host: url.host, accept: "text/*, application/xhtml+xml, application/json, application/xml" },
    agent: false, signal, servername: family ? undefined : host, checkServerIdentity: (_, cert) => checkServerIdentity(host, cert),
  };
  return new Promise((resolve, reject) => {
    request(options, resolve).once("error", reject).end();
  });
}

export async function readWebPage(input: string): Promise<{ url: string; contentType: string; body: string; truncated: boolean; untrusted: true }> {
  let url: URL = webUrl(input);
  const signal: AbortSignal = AbortSignal.timeout(10_000);
  for (let hop: number = 0; hop <= 4; hop++) {
    const response: IncomingMessage = await responseFor(url, signal);
    const status: number = response.statusCode ?? 0;
    if (redirects.has(status) && response.headers.location) {
      response.destroy();
      url = webUrl(response.headers.location, url);
      continue;
    }
    const contentType: string = (response.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    if (status < 200 || status >= 300 || !/^(text\/|application\/(?:xhtml\+xml|json|xml)$)/.test(contentType)) {
      response.destroy();
      throw new Error(status < 200 || status >= 300 ? `The page returned HTTP ${status}.` : "The link did not return a text page.");
    }
    const chunks: Buffer[] = [];
    let length: number = 0;
    for await (const chunk of response as AsyncIterable<Buffer>) {
      chunks.push(chunk.subarray(0, maxBytes - length));
      length += chunk.length;
      if (length > maxBytes) break;
    }
    return { url: url.href, contentType, body: Buffer.concat(chunks).toString("utf8"), truncated: length > maxBytes, untrusted: true };
  }
  throw new Error("The page redirected too many times.");
}
