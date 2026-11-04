import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { findProgram, type Adapter } from "../../worker/agents.ts";
import acp from "../acp/agent.ts";

const elsewhere = () => [path.join(homedir(), ".local", "bin", "agy")];

export default {
  command: (turn) =>
    acp.command({
      ...turn,
      command: turn.command?.length
        ? turn.command
        : [
            findProgram("agy", elsewhere),
            "acp",
            ...(turn.access === "full" ? ["--dangerously-skip-permissions"] : []),
          ],
    }),
  read: acp.read,
  link: (session) => `alma://thread/${session}`,
  check() {
    try {
      const program = findProgram("agy", elsewhere);
      execFileSync(program, ["--version"], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] });
      return null;
    } catch (error) {
      return `Antigravity (agy) 用不了：${(error as Error).message.split("\n")[0]}`;
    }
  },
} satisfies Adapter;
