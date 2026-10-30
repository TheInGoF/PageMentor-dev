// ffmpeg/ffprobe als Unterprozess, Pfad über tools.ts
import { spawn } from "child_process";
import { toolPath } from "../../tools";


export async function run(
  bin: string,
  args: string[],
  opts?: {
    liveStderr?: boolean;
    logPrefix?: string;
    // Pro stderr-Zeile; Fortschritt kommt mit \r getrennt
    onStderrLine?: (line: string) => void;
  }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(toolPath(bin), args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const prefix = opts?.logPrefix ?? `[${bin}]`;
    // Fortschrittszeilen kommen alle 0,5 s; ins Log nur alle 10 s
    let lastProgressLog = 0;
    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => {
      const chunk = b.toString();
      stderr += chunk;
      const lines = chunk
        .split(/[\r\n]+/)
        .filter((l: string) => l.trim().length > 0);
      for (const line of lines) {
        const progress = /^\s*(frame|size)=/.test(line);
        if (opts?.liveStderr && (!progress || Date.now() - lastProgressLog >= 10_000)) {
          if (progress) lastProgressLog = Date.now();
          console.log(`${prefix} ${line}`);
        }
        opts?.onStderrLine?.(line);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${bin} exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}
