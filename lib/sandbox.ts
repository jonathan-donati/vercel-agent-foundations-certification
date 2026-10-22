import { Sandbox } from "@vercel/sandbox";

export const SANDBOX_NAME = "admin-agent-sandbox";

// Where the agent keeps memories.md and scripts/. The sandbox image's default
// working directory is /vercel (not /vercel/sandbox), so this folder doesn't
// exist until we create it.
export const SANDBOX_WORKDIR = "/vercel/sandbox";

export async function ensureWorkdir(sandbox: Sandbox) {
    await sandbox.runCommand("mkdir", ["-p", `${SANDBOX_WORKDIR}/scripts`]);
}

export const createOrGetSandbox = async (name: string) => {
    try {
        const sandbox = await Sandbox.get({ name });
        return sandbox;
    } catch {
        const sandbox = await Sandbox.create({
            name,
            snapshotExpiration: 7 * 24 * 60 * 60 * 1000,
            timeout: 2700000
        });
        return sandbox;
    }
};