import type { Express } from "express";
import http from "http";
import { AddressInfo } from "net";

type Headers = Record<string, string>;

type ResponseShape = {
  status: number;
  body: any;
  headers: Headers;
};

class TestRequest {
  private app: Express;
  private method: string;
  private path: string;
  private headers: Headers = {};
  private body: any = undefined;

  constructor(app: Express, method: string, path: string) {
    this.app = app;
    this.method = method.toUpperCase();
    this.path = path;
  }

  set(name: string, value: string) {
    this.headers[name] = value;
    return this;
  }

  send(body: any) {
    this.body = body;
    if (body !== undefined && this.headers["Content-Type"] === undefined) {
      this.headers["Content-Type"] = "application/json";
    }
    return this;
  }

  async expect(status: number) {
    const res = await this.exec();
    if (res.status !== status) {
      throw new Error(`Expected status ${status} but received ${res.status}`);
    }
    return res;
  }

  private async exec(): Promise<ResponseShape> {
    const server = http.createServer(this.app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}${this.path}`;

    const init: RequestInit = {
      method: this.method,
      headers: this.headers,
    };

    if (this.body !== undefined) {
      init.body = typeof this.body === "string" ? this.body : JSON.stringify(this.body);
    }

    const response = await fetch(url, init);
    const text = await response.text();
    server.close();

    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }

    const headers: Headers = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return { status: response.status, body: json, headers };
  }
}

class RequestBuilder {
  private app: Express;

  constructor(app: Express) {
    this.app = app;
  }

  post(path: string) {
    return new TestRequest(this.app, "POST", path);
  }
}

export default function request(app: Express) {
  return new RequestBuilder(app);
}
