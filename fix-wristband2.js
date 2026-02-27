const fs = require("fs");
let content = fs.readFileSync("public/entry-scanner.html", "utf8");

// Simple replace of just the key line
content = content.replace(
  "wristbandInput.onchange = async function() {",
  "wristbandInput.onkeydown = async function(e) {\n                if (e.key !== 'Enter') return;\n                e.preventDefault();"
);

fs.writeFileSync("public/entry-scanner.html", content, "utf8");
console.log(content.includes("onkeydown") ? "Fixed!" : "Failed");
