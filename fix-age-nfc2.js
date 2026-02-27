const fs = require("fs");
let content = fs.readFileSync("public/age-verification.html", "utf8");

// Replace the fake keydown dispatch with direct function call
content = content.replace(
  "document.getElementById('wristbandId').value = uid;\n                            document.getElementById('wristbandId').dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter'}));",
  "document.getElementById('wristbandId').value = uid;\n                            await approveWristband(uid);"
);

// Extract the approve logic into its own function
// Find the keydown handler content and wrap it
content = content.replace(
  "document.getElementById('wristbandId').addEventListener('keydown', async function(e) {\n            if (e.key !== 'Enter') return;\n            e.preventDefault();",
  "document.getElementById('wristbandId').addEventListener('keydown', async function(e) {\n            if (e.key !== 'Enter') return;\n            e.preventDefault();\n            const uid = this.value.trim().toUpperCase();\n            if (uid) await approveWristband(uid);\n        });\n\n        async function approveWristband(uid) {"
);

fs.writeFileSync("public/age-verification.html", content, "utf8");
console.log("Done");
