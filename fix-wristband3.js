const fs = require("fs");
let content = fs.readFileSync("public/entry-scanner.html", "utf8");

// Make the wristband input visible instead of hidden off-screen
content = content.replace(
  "wristbandInput.style.position = 'absolute';",
  "wristbandInput.style.position = 'relative';"
);
content = content.replace(
  "wristbandInput.style.left = '-9999px';",
  "wristbandInput.style.width = '100%'; wristbandInput.style.padding = '15px'; wristbandInput.style.fontSize = '18px'; wristbandInput.style.border = '2px solid #00B74A'; wristbandInput.style.borderRadius = '10px'; wristbandInput.style.marginTop = '10px'; wristbandInput.placeholder = 'Tap wristband or type UID and press Enter';"
);

fs.writeFileSync("public/entry-scanner.html", content, "utf8");
console.log("Done - input is now visible");
