const fs = require("fs");
let content = fs.readFileSync("public/age-verification.html", "utf8");

// 1. Fix the onchange to onkeydown for manual/USB input
content = content.replace(
  "document.getElementById('wristbandId').addEventListener('change', async function() {",
  "document.getElementById('wristbandId').addEventListener('keydown', async function(e) {\n            if (e.key !== 'Enter') return;\n            e.preventDefault();"
);

// 2. Add NFC button after the wristband input field
const nfcButton = `
            // Add NFC support
            if ('NDEFReader' in window) {
                const nfcBtn = document.createElement('button');
                nfcBtn.innerHTML = '?? Tap Here to Enable NFC Scanning';
                nfcBtn.style.cssText = 'width:100%;padding:15px;font-size:16px;font-weight:bold;background:#00B74A;color:white;border:none;border-radius:10px;margin-top:10px;cursor:pointer;';
                document.getElementById('scanCard').querySelector('.form-group').appendChild(nfcBtn);
                nfcBtn.addEventListener('click', async function() {
                    try {
                        const ndef = new NDEFReader();
                        await ndef.scan();
                        nfcBtn.innerHTML = '? NFC Active - Tap Wristband Now';
                        nfcBtn.style.background = '#2d7a4f';
                        ndef.onreading = async (event) => {
                            const uid = event.serialNumber.replace(/:/g, '').toUpperCase();
                            console.log("NFC tag read:", uid);
                            document.getElementById('wristbandId').value = uid;
                            document.getElementById('wristbandId').dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter'}));
                        };
                    } catch(err) {
                        nfcBtn.innerHTML = '? NFC Failed: ' + err.message;
                        nfcBtn.style.background = '#e53e3e';
                    }
                });
            }`;

// Insert NFC code after the wristband change listener block
content = content.replace(
  "document.getElementById('wristbandId').focus();",
  "document.getElementById('wristbandId').focus();\n" + nfcButton
);

fs.writeFileSync("public/age-verification.html", content, "utf8");
console.log(content.includes("NDEFReader") ? "Fixed!" : "Failed");
