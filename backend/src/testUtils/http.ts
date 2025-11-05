import http from "http";
import type { AddressInfo } from "net";
import type express from "express";

interface RequestOptions {
  method?: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface JsonResponse<T = any> {
  status: number;
  body: T;
  headers: Record<string, string>;
}

export async function requestJson<T = any>(
  app: express.Express,
  { method = "GET", path, headers = {}, body }: RequestOptions,
): Promise<JsonResponse<T>> {
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  try {
    const address = server.address() as AddressInfo | null;
    if (!address) {
      throw new Error("Server did not provide an address");
    }

    const normalizedHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      normalizedHeaders[key.toLowerCase()] = value;
    }

    if (body !== undefined && !normalizedHeaders["content-type"]) {
      normalizedHeaders["content-type"] = "application/json";
    }

    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: normalizedHeaders,
      body:
        body === undefined
          ? undefined
          : normalizedHeaders["content-type"]?.includes("application/json")
            ? JSON.stringify(body)
            : (body as any),
    });

    const text = await response.text();
    let json: any;
    try {
      json = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }

    const responseHeaders: Record<string, string> = {};
    for (const [key, value] of response.headers.entries()) {
      responseHeaders[key] = value;
    }

    return {
      status: response.status,
      body: json,
      headers: responseHeaders,
    };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
