import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const safety = require("../../supabase/audits/sa33c-fresh-install-verify.cjs") as {
  authorizeLifecycle: (input: Record<string, any>) => Record<string, any>;
  authorizePreparation: (input: Record<string, any>) => Record<string, any>;
  buildManifest: (input: Fixture) => Manifest;
  evaluatePrestartGate: (input: Omit<Fixture, "repository">) => Record<string, any>;
  executeLifecycleAction: (input: Record<string, any>) => unknown;
  exactCleanupCommands: (manifest: Manifest, current: { container: Container; network: Network }) => string[][];
  validateManifest: (manifest: unknown) => Manifest;
  validateStartedTarget: (input: { manifest: Manifest; container: Container; network: Network; image: Image }) => unknown;
  validateStoppedTarget: (input: Omit<Fixture, "repository">) => unknown;
  verifyStartGate: (input: { manifest: Manifest; container: Container; network: Network; image: Image }) => { containerId: string };
  runPrestartGate: (input: Omit<Fixture, "repository">, callbacks?: Record<string, unknown>) => Record<string, any>;
  runMandatoryLifecycle: (input: Record<string, any>) => Record<string, any>;
  lifecycleTargetBinding: (input: Omit<Fixture, "repository">) => string;
};

type Container = Record<string, any>;
type Network = Record<string, any>;
type Image = Record<string, any>;
type Manifest = Record<string, any>;
type Fixture = {
  plan: Record<string, any>;
  container: Container;
  network: Network;
  image: Image;
  persistent: { containerIds: string[]; networkIds: string[]; volumeNames: string[] };
  repository: Record<string, any>;
};

const ids = {
  container: "a".repeat(64),
  network: "b".repeat(64),
  image: `sha256:${"c".repeat(64)}`,
  workspace: "d".repeat(64),
  workspaceNetwork: "e".repeat(64),
};
const runId = "11111111-2222-4333-8444-555555555555";

function fixture(): Fixture {
  const names = { container: "serveflow-sa33e-111111111111-db", network: "serveflow-sa33e-111111111111-net" };
  return {
    plan: {
      runId,
      createdAt: "2026-10-17T06:00:00.000Z",
      imageRef: "public.ecr.aws/supabase/postgres:17.6.1.141",
      imageId: ids.image,
      containerId: ids.container,
      networkId: ids.network,
      names,
      dockerContext: { name: "desktop-linux", endpoint: "npipe:////./pipe/dockerDesktopLinuxEngine" },
      hostedFallback: { supabaseCliUsed: false, linkedProjectRead: false, environmentFilesRead: false, credentialSources: [] },
    },
    image: { Id: ids.image, Config: { Volumes: null } },
    container: {
      Id: ids.container,
      Name: `/${names.container}`,
      Image: ids.image,
      State: { Running: false, Status: "created" },
      Config: {
        Labels: { "serveflow.sa33e.disposable": runId },
        Cmd: ["-c", "sleep infinity"],
        Entrypoint: ["/bin/sh"],
        User: "postgres",
        Healthcheck: { Test: ["NONE"] },
        Env: ["PATH=/usr/local/bin", "PG_MAJOR=17"],
      },
      HostConfig: {
        ReadonlyRootfs: true,
        Privileged: false,
        CapAdd: null,
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges"],
        PortBindings: {},
        PublishAllPorts: false,
        Binds: null,
        Tmpfs: {
          "/sa33e": "rw,nosuid,nodev,noexec,size=1024m,mode=0700",
          "/tmp": "rw,nosuid,nodev,noexec,size=64m,mode=1777",
        },
        Devices: [],
        NetworkMode: names.network,
        ExtraHosts: null,
        Links: null,
        RestartPolicy: { Name: "no", MaximumRetryCount: 0 },
      },
      Mounts: [],
      NetworkSettings: { Networks: { [names.network]: { NetworkID: ids.network } } },
    },
    network: {
      Id: ids.network,
      Name: names.network,
      Driver: "bridge",
      Internal: true,
      Attachable: false,
      Ingress: false,
      Labels: { "serveflow.sa33e.disposable": runId },
      Options: {},
      Containers: {},
    },
    persistent: {
      containerIds: [ids.workspace],
      networkIds: [ids.workspaceNetwork],
      volumeNames: ["supabase_db_workspace"],
    },
    repository: { migrationCount: 278, migrationSetSha256: "f".repeat(64), migrations: [] },
  };
}

function manifestFor(input = fixture()) {
  return safety.buildManifest(input);
}

describe("SA3.3E stopped-resource preflight", () => {
  it("accepts a new stopped inert target with internal networking and tmpfs-only storage", () => {
    const input = fixture();
    const manifest = manifestFor(input);

    expect(manifest.decision).toBe("PREFLIGHT_PASS_STOPPED_RESOURCES_ONLY");
    expect(manifest.resources.container.id).toBe(ids.container);
    expect(manifest.resources.network.internal).toBe(true);
    expect(manifest.resources.volumes).toEqual([]);
    expect(manifest.startGate.migrationExecutionAuthorized).toBe(false);
  });

  it("rejects a persistent workspace container ID", () => {
    const input = fixture();
    input.persistent.containerIds.push(ids.container);
    expect(() => manifestFor(input)).toThrow(/persistent container ID/i);
  });

  it("rejects a persistent or pre-existing volume as writable database storage", () => {
    const input = fixture();
    input.container.Mounts = [{ Type: "volume", Name: "supabase_db_workspace", Source: "/var/lib/docker/volumes/workspace", Destination: "/sa33e", RW: true }];
    expect(() => manifestFor(input)).toThrow(/only tmpfs mounts/i);
  });

  it("rejects every host port binding, including loopback", () => {
    for (const hostIp of ["0.0.0.0", "::", "127.0.0.1", "::1"]) {
      const input = fixture();
      input.container.HostConfig.PortBindings = { "5432/tcp": [{ HostIp: hostIp, HostPort: "60000" }] };
      expect(() => manifestFor(input), hostIp).toThrow(/host port bindings/i);
    }
  });

  it.each([
    "C:/Users/user/ServeFlow:/workspace",
    "C:/Users/user:/profile",
    "/var/run/docker.sock:/var/run/docker.sock",
    "\\\\.\\pipe\\docker_engine:\\\\.\\pipe\\docker_engine",
  ])("rejects bind mount %s", (binding) => {
    const input = fixture();
    input.container.HostConfig.Binds = [binding];
    expect(() => manifestFor(input)).toThrow(/bind mounts/i);
  });

  it("rejects a missing or non-internal network", () => {
    const missing = fixture();
    delete missing.network.Internal;
    expect(() => manifestFor(missing)).toThrow(/must be internal/i);
    const external = fixture();
    external.network.Internal = false;
    expect(() => manifestFor(external)).toThrow(/must be internal/i);
  });

  it("rejects unexpected network membership and host-gateway routes", () => {
    const membership = fixture();
    membership.container.NetworkSettings.Networks.bridge = {};
    expect(() => manifestFor(membership)).toThrow(/unexpected network membership/i);
    const hostRoute = fixture();
    hostRoute.container.HostConfig.ExtraHosts = ["host.docker.internal:host-gateway"];
    expect(() => manifestFor(hostRoute)).toThrow(/host aliases/i);
    const otherMember = fixture();
    otherMember.network.Containers["7".repeat(64)] = { Name: "unrelated" };
    expect(() => manifestFor(otherMember)).toThrow(/dedicated network contains/i);
  });

  it("rejects hosted-link and credential fallback", () => {
    const linked = fixture();
    linked.plan.hostedFallback.linkedProjectRead = true;
    expect(() => manifestFor(linked)).toThrow(/linked project fallback/i);
    const credential = fixture();
    credential.container.Config.Env.push("SUPABASE_ACCESS_TOKEN=forbidden");
    expect(() => manifestFor(credential)).toThrow(/credential environment/i);
  });

  it.each([
    ["container ID", (input: Fixture) => delete input.container.Id],
    ["image identity", (input: Fixture) => delete input.image.Id],
    ["mount data", (input: Fixture) => delete input.container.Mounts],
    ["network data", (input: Fixture) => delete input.container.NetworkSettings],
  ])("fails closed when %s is missing", (_label, mutate) => {
    const input = fixture();
    mutate(input);
    expect(() => manifestFor(input)).toThrow();
  });
});

describe("SA3.3E manifest, start gate, and cleanup", () => {
  it("rejects missing and malformed manifests", () => {
    expect(() => safety.validateManifest(undefined)).toThrow(/manifest is missing/i);
    expect(() => safety.validateManifest({ schema: "wrong" })).toThrow(/schema is invalid/i);
  });

  it("approves only the unchanged exact stopped resource from the manifest", () => {
    const input = fixture();
    const manifest = manifestFor(input);
    expect(safety.verifyStartGate({ manifest, container: input.container, network: input.network, image: input.image }).containerId)
      .toBe(ids.container);
  });

  it("rechecks ports, mounts, identity, and exclusive network membership after a mocked start", () => {
    const input = fixture();
    const manifest = manifestFor(input);
    const running = structuredClone(input.container);
    running.State = { Running: true, Status: "running" };
    running.Mounts = [
      { Type: "tmpfs", Source: "", Destination: "/sa33e", RW: true },
      { Type: "tmpfs", Source: "", Destination: "/tmp", RW: true },
    ];
    const runningNetwork = structuredClone(input.network);
    runningNetwork.Containers[ids.container] = { Name: input.plan.names.container };
    expect(() => safety.validateStartedTarget({ manifest, container: running, network: runningNetwork, image: input.image }))
      .not.toThrow();
    running.Mounts.push({ Type: "bind", Source: "C:/Users/user", Destination: "/host", RW: true });
    expect(() => safety.validateStartedTarget({ manifest, container: running, network: runningNetwork, image: input.image }))
      .toThrow(/non-tmpfs mount/i);
  });

  it("rejects an altered or replaced resource after manifest creation", () => {
    const input = fixture();
    const manifest = manifestFor(input);
    const replaced = structuredClone(input.container);
    replaced.Id = "9".repeat(64);
    expect(() => safety.verifyStartGate({ manifest, container: replaced, network: input.network, image: input.image }))
      .toThrow(/container ID differs/i);
    const altered = structuredClone(input.container);
    altered.HostConfig.ReadonlyRootfs = false;
    expect(() => safety.verifyStartGate({ manifest, container: altered, network: input.network, image: input.image }))
      .toThrow(/read-only/i);
  });

  it("builds cleanup commands from exact IDs and rejects replacement", () => {
    const input = fixture();
    const manifest = manifestFor(input);
    expect(safety.exactCleanupCommands(manifest, { container: input.container, network: input.network })).toEqual([
      ["container", "rm", ids.container],
      ["network", "rm", ids.network],
    ]);
    const replaced = structuredClone(input.container);
    replaced.Id = "8".repeat(64);
    expect(() => safety.exactCleanupCommands(manifest, { container: replaced, network: input.network }))
      .toThrow(/cleanup container identity changed/i);
  });

  it("contains no implicit Supabase orchestration or database execution path", () => {
    const source = readFileSync("supabase/audits/sa33c-fresh-install-verify.cjs", "utf8");
    expect(source).not.toMatch(/supabase\s+start|db\s+reset|migration\s+up|--linked/);
    expect(source).not.toMatch(/\bpsql\b|\binitdb\b|\bpg_ctl\b/);
    expect(source).toContain("docker(['start', decision.containerId])");
    expect(source).toContain("docker(['stop', '--time', '1', manifest.resources.container.id])");
    expect(source).not.toMatch(/docker\(\['start',\s*(?:plan\.names|manifest\.resources\.container\.name)/);
    expect(source).not.toMatch(/docker\(\['stop',[\s\S]{0,80}(?:plan\.names|manifest\.resources\.container\.name)/);
  });
});

describe("B1A.4 pure pre-start safety gate", () => {
  function prestartInput() {
    const { repository: _repository, ...input } = fixture();
    return input;
  }

  it("completes a valid synthetic preflight without authorizing startup or writes", () => {
    const result = safety.evaluatePrestartGate(prestartInput());
    expect(result).toMatchObject({ ok: true, decision: "PRESTART_VALIDATED_NO_STARTUP", startupAuthorized: false, writeAuthorized: false });
    expect(result.passed).toHaveLength(6);
    expect(result.runtimeStorageVerified).toBe(false);
  });

  it.each([
    ["a workspace container name", (input: any) => { input.plan.names.container = "supabase_db_workspace"; }],
    ["a protected SA3.3F name", (input: any) => { input.plan.names.network = "serveflow-sa33e-b88095f8-4d0-net"; }],
    ["a persistent container ID", (input: any) => { input.persistent.containerIds.push(input.plan.containerId); }],
  ])("rejects %s without adopting an existing target", (_label, mutate) => {
    const input = prestartInput();
    mutate(input);
    expect(safety.evaluatePrestartGate(input)).toMatchObject({ ok: false, failed: "target_identity", startupAuthorized: false });
  });

  it.each([
    ["a missing explicit image reference", (input: any) => { delete input.plan.imageRef; }, "configuration"],
    ["an image identity change", (input: any) => { input.image.Id = `sha256:${"9".repeat(64)}`; }, "image_identity"],
    ["an external network", (input: any) => { input.network.Internal = false; }, "network_isolation"],
    ["host port publication", (input: any) => { input.container.HostConfig.PortBindings = { "5432/tcp": [{ HostPort: "5432" }] }; }, "storage_and_restrictions"],
    ["a bind mount", (input: any) => { input.container.HostConfig.Binds = ["C:/host:/host"]; }, "storage_and_restrictions"],
    ["missing tmpfs evidence", (input: any) => { delete input.container.HostConfig.Tmpfs["/tmp"]; }, "storage_and_restrictions"],
    ["a Docker socket mount", (input: any) => { input.container.Mounts = [{ Type: "bind", Source: "/var/run/docker.sock", Destination: "/sock" }]; }, "storage_and_restrictions"],
  ])("fails closed for %s", (_label, mutate, failed) => {
    const input = prestartInput();
    mutate(input);
    expect(safety.evaluatePrestartGate(input)).toMatchObject({ ok: false, failed, startupAuthorized: false, writeAuthorized: false });
  });

  it("stops at the first failed stage and does not treat a partial result as success", () => {
    const input = prestartInput();
    delete input.plan.imageRef;
    input.network.Internal = false;
    const result = safety.evaluatePrestartGate(input);
    expect(result).toMatchObject({ ok: false, failed: "configuration", passed: [] });
  });

  it("never calls startup, write, or cleanup callbacks on either pass or rejection", () => {
    const callbacks = { startup: vi.fn(), write: vi.fn(), cleanup: vi.fn() };
    expect(safety.runPrestartGate(prestartInput(), callbacks).ok).toBe(true);
    const rejected = prestartInput();
    rejected.container.HostConfig.Binds = ["C:/host:/host"];
    expect(safety.runPrestartGate(rejected, callbacks).ok).toBe(false);
    expect(callbacks.startup).not.toHaveBeenCalled();
    expect(callbacks.write).not.toHaveBeenCalled();
    expect(callbacks.cleanup).not.toHaveBeenCalled();
  });

  it("returns a generic rejection without exposing credential-like snapshot contents", () => {
    const input = prestartInput();
    input.container.Config.Env = { broken: "SUPABASE_ACCESS_TOKEN=super-secret" };
    const result = safety.evaluatePrestartGate(input);
    expect(result).toMatchObject({ ok: false, decision: "PRESTART_REJECTED" });
    expect(JSON.stringify(result)).not.toContain("super-secret");
  });
});

describe("B1A.6 mandatory lifecycle authorization", () => {
  function lifecycleInput() {
    const { repository: _repository, ...input } = fixture();
    return input;
  }

  function runtimeProof(input: ReturnType<typeof lifecycleInput>) {
    return { schema: "serveflow.sa33e.runtime-proof.v1", binding: safety.lifecycleTargetBinding(input), runtimeStorageVerified: true };
  }

  it("routes preparation and startup through the mandatory lifecycle boundary", () => {
    const source = readFileSync("supabase/audits/sa33c-fresh-install-verify.cjs", "utf8");
    expect(source).toContain("runMandatoryLifecycle({ operation: 'prepare'");
    expect(source).toContain("runMandatoryLifecycle({ operation: 'start'");
  });

  it("allows only a fully target-bound synthetic startup action", () => {
    const input = lifecycleInput();
    const start = vi.fn();
    const result = safety.runMandatoryLifecycle({ operation: "start", input, runtimeProof: runtimeProof(input), actions: { start } });
    expect(result.ok).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("rejects configuration-only preflight and never calls start or write", () => {
    const input = lifecycleInput();
    const start = vi.fn();
    const write = vi.fn();
    const result = safety.runMandatoryLifecycle({ operation: "start", input, actions: { start, write } });
    expect(result.ok).toBe(false);
    expect(start).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it.each([
    ["a thrown gate", () => { throw new Error("gate failed"); }],
    ["a rejected promise", () => Promise.reject(new Error("gate rejected"))],
    ["a malformed result", () => ({ ok: true })],
    ["a rejected result", () => ({ schema: "serveflow.sa33e.lifecycle-authorization.v1", ok: false })],
  ])("fails closed for %s with zero actions", (_label, gate) => {
    const input = lifecycleInput();
    const start = vi.fn();
    const write = vi.fn();
    const result = safety.runMandatoryLifecycle({ operation: "start", input, gate, actions: { start, write } });
    expect(result.ok).toBe(false);
    expect(start).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it.each([
    ["identity", (input: any) => { input.container.Id = "9".repeat(64); }],
    ["image", (input: any) => { input.image.Id = `sha256:${"8".repeat(64)}`; }],
    ["network", (input: any) => { input.network.Internal = false; }],
    ["port", (input: any) => { input.container.HostConfig.PortBindings = { "5432/tcp": [{ HostPort: "5432" }] }; }],
    ["socket mount", (input: any) => { input.container.Mounts = [{ Type: "bind", Source: "/var/run/docker.sock", Destination: "/sock" }]; }],
    ["tmpfs", (input: any) => { delete input.container.HostConfig.Tmpfs["/tmp"]; }],
  ])("does not authorize an unsafe %s target", (_label, mutate) => {
    const input = lifecycleInput();
    mutate(input);
    const start = vi.fn();
    const result = safety.runMandatoryLifecycle({ operation: "start", input, runtimeProof: runtimeProof(input), actions: { start } });
    expect(result.ok).toBe(false);
    expect(start).not.toHaveBeenCalled();
  });

  it("invalidates authorization when the target changes after validation", () => {
    const input = lifecycleInput();
    const authorization = safety.authorizeLifecycle({ operation: "start", input, runtimeProof: runtimeProof(input) });
    input.container.HostConfig.Binds = ["C:/host:/host"];
    const start = vi.fn();
    expect(() => safety.executeLifecycleAction({ operation: "start", input, authorization, actions: { start } })).toThrow(/target changed/i);
    expect(start).not.toHaveBeenCalled();
  });

  it("does not turn preparation or startup authorization into write authorization", () => {
    const input = lifecycleInput();
    const preparePlan = structuredClone(input.plan);
    delete preparePlan.containerId;
    delete preparePlan.networkId;
    const preparation = safety.authorizePreparation({ plan: preparePlan, image: input.image, persistent: input.persistent });
    expect(preparation).toMatchObject({ ok: true, preparationAuthorized: true, startupAuthorized: false, writeAuthorized: false });
    const write = vi.fn();
    expect(safety.runMandatoryLifecycle({ operation: "write", input, actions: { write } }).ok).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });
});
