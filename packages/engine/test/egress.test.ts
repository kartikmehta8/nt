/**
 * @file Security regression tests for the outbound socket DNS guard.
 *
 * Injects deterministic resolver results to prove a completely public address
 * set is accepted and any mixed set containing loopback is rejected at socket
 * lookup time. This specifically covers the DNS-rebinding race independently
 * of live DNS or public network access. Address classification cases also lock
 * down carrier-grade NAT, documentation, benchmark, multicast, and IPv6 ranges.
 */

import assert from "node:assert/strict";
import type { LookupFunction } from "node:net";
import { test } from "node:test";
import { createGuardedLookup, isPrivateAddress } from "#egress";

function runLookup(resolve: LookupFunction): Promise<NodeJS.ErrnoException | null> {
  const guarded = createGuardedLookup(resolve);
  return new Promise((done) => {
    guarded("example.test", { all: true }, (error) => done(error));
  });
}

test("socket-time DNS guard permits a fully public resolution set", async () => {
  const resolver: LookupFunction = (_hostname, _options, callback) =>
    callback(null, [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);
  assert.equal(await runLookup(resolver), null);
});

test("socket-time DNS guard rejects rebinding when any result is private", async () => {
  const resolver: LookupFunction = (_hostname, _options, callback) =>
    callback(null, [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
  const error = await runLookup(resolver);
  assert.equal(error?.code, "EACCES");
  assert.match(error?.message ?? "", /private\/loopback/);
});

test("address classification blocks non-public IPv4 and IPv6 ranges", () => {
  const blocked = [
    "0.0.0.0",
    "10.2.3.4",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "172.31.255.255",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "100::1",
    "2001:2::1",
    "2001:db8::1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
  ];
  for (const address of blocked)
    assert.equal(isPrivateAddress(address), true, `${address} must be blocked`);
  for (const address of ["1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"])
    assert.equal(isPrivateAddress(address), false, `${address} must remain public`);
});
