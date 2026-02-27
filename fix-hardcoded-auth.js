const fs = require("fs");
const path = require("path");

const files = [
  "public/age-verification.html",
  "public/bar-service.html",
  "public/entry-scanner.html",
  "public/gatescanner1.html",
  "public/inventory-manager.html",
  "public/shift-manager.html",
  "public/shift-picker.html"
];

const oldPattern = /const r = await fetch\(API \+ '\/auth\/login',\s*\{[\s\S]*?body: JSON\.stringify\(\{email: 'darren@holmgraphics\.ca', password: 'changeme123'\}\)\s*\}\);\s*const d = await r\.json\(\);\s*token = d\.token;/g;

const newCode = `token = localStorage.getItem('auth_token');
    if (!token) {
        window.location.href = 'login.html';
        return;
    }`;

let fixed = 0;
files.forEach(f => {
  let content = fs.readFileSync(f, "utf8");
  if (content.match(oldPattern)) {
    content = content.replace(oldPattern, newCode);
    fs.writeFileSync(f, content, "utf8");
    console.log("Fixed:", f);
    fixed++;
  } else {
    console.log("Pattern not matched:", f, "- trying simpler replace");
    // Simpler approach
    if (content.includes("changeme123")) {
      content = content.replace(
        /const r = await fetch\([^)]+\/auth\/login'[\s\S]*?token = d\.token;/g,
        newCode
      );
      fs.writeFileSync(f, content, "utf8");
      console.log("Fixed (simple):", f);
      fixed++;
    }
  }
});
console.log("\nTotal fixed:", fixed);
