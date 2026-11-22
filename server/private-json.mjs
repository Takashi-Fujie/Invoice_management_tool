import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  chmodSync,
  lstatSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
export function savePrivateJSON(directory, name, value) {
  if (!directory) return;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (lstatSync(directory).isSymbolicLink())
    throw Error("端末内の保存先を確認してください。");
  chmodSync(directory, 0o700);
  const temporary = join(directory, name + "." + randomUUID() + ".tmp");
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
  renameSync(temporary, join(directory, name));
}
export function readPrivateJSON(directory, name) {
  if (!directory || !existsSync(join(directory, name))) return null;
  const path = join(directory, name),
    stat = lstatSync(path);
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.mode & 0o077 ||
    stat.size > 65536
  )
    throw Error("端末内の保存記録を読み取れません。");
  return JSON.parse(readFileSync(path, "utf8"));
}
