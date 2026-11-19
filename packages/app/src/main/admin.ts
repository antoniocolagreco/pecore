import { execFile } from "node:child_process";

export function runAdmin(script: string): Promise<void> {
  if (process.platform !== "linux") return Promise.reject(new Error("the admin prompt is supported on Linux only for now"));
  return new Promise((resolve, reject) => {
    execFile("pkexec", ["/bin/sh", "-c", script], { maxBuffer: 10 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (!error) return resolve();
      const code = (error as { code?: number | string }).code;
      if (code === "ENOENT") return reject(new Error("pkexec not found: run the script shown in Settings as root"));
      if (code === 126) return reject(new Error("the admin prompt was dismissed"));
      if (code === 127) return reject(new Error("no polkit agent could show the admin prompt: run the script shown in Settings as root"));
      reject(new Error(stderr.trim() || error.message));
    });
  });
}
