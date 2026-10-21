"use strict";
const fs = require("node:fs"),
  { atomic } = require("./store"),
  { Fault } = require("./api");
class Journal {
  constructor(file) {
    this.file = file;
    this.fault = false;
    this.data = {
      version: 2,
      paused: false,
      reads: [],
      shares: [],
      lastAttempt: 0,
    };
    try {
      const d = JSON.parse(fs.readFileSync(file, "utf8"));
      if (
        d.version !== 2 ||
        !Array.isArray(d.reads) ||
        !Array.isArray(d.shares) ||
        typeof d.paused !== "boolean"
      )
        throw Error();
      this.data = d;
      for (const x of d.shares)
        if (["preparing", "submitting"].includes(x.status))
          x.status = "unknown";
      fs.chmodSync(file, 0o600);
      this.save();
    } catch (e) {
      if (e.code !== "ENOENT") this.fault = true;
    }
  }
  save() {
    if (this.fault) throw new Fault("journal-unavailable");
    try {
      atomic(this.file, this.data);
    } catch {
      this.fault = true;
      throw new Fault("journal-save-failed");
    }
  }
  read(bvid) {
    this.data.reads.push({ bvid, at: Date.now() });
    this.data.reads = this.data.reads.slice(-500);
    this.save();
  }
}
module.exports = { Journal };
