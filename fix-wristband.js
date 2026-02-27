const fs = require("fs");
let content = fs.readFileSync("public/entry-scanner.html", "utf8");

content = content.replace(
  `wristbandInput.onchange = async function() {
                if (!wristbandInputActive) return;
                const uid = this.value.trim();
                if (uid) {
                    await assignBand(uid);
                    this.value = '';
                }
                this.focus();
            };`,
  `wristbandInput.onkeydown = async function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (!wristbandInputActive) return;
                    const uid = this.value.trim();
                    if (uid) {
                        await assignBand(uid);
                        this.value = '';
                    }
                    this.focus();
                }
            };`
);

fs.writeFileSync("public/entry-scanner.html", content, "utf8");
console.log(content.includes("onkeydown") ? "Fixed!" : "Replace failed - check manually");
