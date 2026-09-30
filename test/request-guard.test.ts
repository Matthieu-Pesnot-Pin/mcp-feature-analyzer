import assert from "node:assert/strict";
import os from "node:os";
import test from "node:test";

import { allowedHostnames, checkRequest, hostnameOf } from "../src/core/request-guard.js";

const allowed = allowedHostnames("http://proxy.lan:3000");

function request(overrides: Partial<Parameters<typeof checkRequest>[0]>) {
  return { method: "GET", host: "localhost:4000", origin: undefined, contentType: undefined, ...overrides };
}

test("hostnameOf strips the port and the IPv6 brackets", () => {
  assert.equal(hostnameOf("LocalHost:4000"), "localhost");
  assert.equal(hostnameOf("[::1]:4000"), "::1");
  assert.equal(hostnameOf("127.0.0.1"), "127.0.0.1");
  assert.equal(hostnameOf(""), null);
});

test("the loopback names, the machine and the proxy host are allowed", () => {
  for (const name of ["localhost", "127.0.0.1", "::1", os.hostname().toLowerCase(), "proxy.lan"]) {
    assert.ok(allowed.has(name), name);
  }
  assert.equal(allowed.has("attacker.example"), false);
});

test("a read is accepted from an allowed host and refused from any other", () => {
  assert.equal(checkRequest(request({}), allowed), null);
  assert.equal(checkRequest(request({ host: "[::1]:4000" }), allowed), null);
  assert.equal(checkRequest(request({ host: "proxy.lan:3000" }), allowed), null);
  assert.equal(checkRequest(request({ host: "attacker.example" }), allowed)?.status, 403);
  assert.equal(checkRequest(request({ host: undefined }), allowed)?.status, 403);
});

test("a modification requires a JSON body", () => {
  assert.equal(checkRequest(request({ method: "POST", contentType: "application/json; charset=utf-8" }), allowed), null);
  assert.equal(checkRequest(request({ method: "POST", contentType: "text/plain" }), allowed)?.status, 415);
  assert.equal(checkRequest(request({ method: "DELETE", contentType: undefined }), allowed)?.status, 415);
  assert.equal(checkRequest(request({ method: "POST", contentType: "application/x-www-form-urlencoded" }), allowed)?.status, 415);
});

test("a modification from another origin is refused, the same origin is accepted", () => {
  const json = { method: "POST", contentType: "application/json" };
  assert.equal(checkRequest(request({ ...json, origin: "http://localhost:4000" }), allowed), null);
  assert.equal(checkRequest(request({ ...json, host: "proxy.lan:3000", origin: "http://proxy.lan:3000" }), allowed), null);
  assert.equal(checkRequest(request({ ...json, origin: "http://attacker.example" }), allowed)?.status, 403);
  assert.equal(checkRequest(request({ ...json, origin: "http://localhost:9999" }), allowed)?.status, 403);
  assert.equal(checkRequest(request({ ...json, origin: "null" }), allowed)?.status, 403);
});
