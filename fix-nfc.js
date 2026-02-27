const fs = require("fs");
let content = fs.readFileSync("public/entry-scanner.html", "utf8");

// Replace the listenForWristbands function with Web NFC API
const oldFunc = content.substring(
  content.indexOf("function listenForWristbands()"),
  content.indexOf("async function assignBand")
);

const newFunc = `function listenForWristbands() {
            if ('NDEFReader' in window) {
                const ndef = new NDEFReader();
                ndef.scan().then(() => {
                    console.log("NFC scan started");
                    document.getElementById('nfcStatus').textContent = 'Ready - Tap wristband';
                    ndef.onreading = async (event) => {
                        if (!wristbandInputActive) return;
                        const uid = event.serialNumber.replace(/:/g, '').toUpperCase();
                        console.log("NFC tag read:", uid);
                        await assignBand(uid);
                    };
                    ndef.onreadingerror = () => {
                        console.log("NFC read error - try again");
                    };
                }).catch(err => {
                    console.error("NFC error:", err);
                    document.getElementById('nfcStatus').textContent = 'NFC not available - enter UID manually';
                    showManualInput();
                });
            } else {
                console.log("Web NFC not supported");
                document.getElementById('nfcStatus').textContent = 'NFC not supported - enter UID manually';
                showManualInput();
            }
        }

        function showManualInput() {
            let manualDiv = document.getElementById('manualWristband');
            if (!manualDiv) {
                manualDiv = document.createElement('div');
                manualDiv.id = 'manualWristband';
                manualDiv.style.marginTop = '15px';
                manualDiv.innerHTML = '<input type="text" id="manualUidInput" placeholder="Type wristband UID and press Enter" style="width:100%;padding:15px;font-size:18px;border:2px solid #00B74A;border-radius:10px;text-align:center;">';
                document.getElementById('assignmentScreen').appendChild(manualDiv);
                document.getElementById('manualUidInput').onkeydown = async function(e) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        const uid = this.value.trim().toUpperCase();
                        if (uid) {
                            await assignBand(uid);
                            this.value = '';
                        }
                    }
                };
            }
            document.getElementById('manualUidInput').focus();
        }

        `;

content = content.replace(oldFunc, newFunc);

// Add NFC status indicator to the assignment screen
content = content.replace(
  'Tap or scan wristband NFC tags',
  'Tap or scan wristband NFC tags</p><p id="nfcStatus" style="color:#00B74A;font-weight:bold;margin-top:10px;">Initializing NFC...'
);

fs.writeFileSync("public/entry-scanner.html", content, "utf8");
console.log(content.includes("NDEFReader") ? "Fixed with Web NFC!" : "Failed");
