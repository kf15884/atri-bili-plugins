"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  { Fault } = require("./transport");
function atomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + "." + crypto.randomBytes(6).toString("hex") + ".tmp";
  let fd;
  try {
    fd = fs.openSync(tmp, "wx", 0o600);
    fs.writeFileSync(fd, JSON.stringify(data));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, file);
    const d = fs.openSync(path.dirname(file), "r");
    try {
      fs.fsyncSync(d);
    } finally {
      fs.closeSync(d);
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try {
      fs.unlinkSync(tmp);
    } catch {}
  }
}
module.exports = { atomic };
