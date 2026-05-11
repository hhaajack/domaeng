#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

fs.rmSync(path.join(__dirname, "..", "bundled"), {
  recursive: true,
  force: true,
});
