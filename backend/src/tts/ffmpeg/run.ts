// ffmpeg/ffprobe als Unterprozess, muss im PATH liegen
import { spawn } from "child_process";


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
    const child = spawn(bin, args);
    let stdout = "";
    let stderr = "";
    const prefix = opts?.logPrefix ?? `[${bin}]`;
    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => {
      const chunk = b.toString();
      stderr += chunk;
      const lines = chunk
        .split(/[\r\n]+/)
        .filter((l: string) => l.trim().length > 0);
      for (const line of lines) {
        if (opts?.liveStderr) console.log(`${prefix} ${line}`);
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
